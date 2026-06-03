"""
Human-in-the-Loop Retraining Pipeline
=======================================
Triggered automatically when expert corrections reach the threshold (default: 20).
Fine-tunes all 5 ensemble models on the new correction data.
API stays live during retraining (runs as a background task).
"""

import os
import sys

# Ensure project root and backend directories are in sys.path so imports resolve
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
_BACKEND = os.path.join(_HERE, "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from PIL import Image
import numpy as np
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

WEIGHTS_DIR        = os.getenv("WEIGHTS_DIR", "models/weights")
CORRECTIONS_DIR    = os.getenv("CORRECTIONS_DIR", "corrections")
DEVICE             = "cuda" if torch.cuda.is_available() else "cpu"
FINETUNE_EPOCHS    = 100
LEARNING_RATE      = 1e-4


class SegmentationDataset(Dataset):
    """
    Combined dataset: original training data + expert corrections.
    Prevents catastrophic forgetting by always training on both.
    """

    def __init__(self, pairs: list, size: int = 256):
        self.size  = size
        self.pairs = pairs  # list of (image_path, mask_path)

    def __len__(self):
        return len(self.pairs)

    def __getitem__(self, idx):
        img_path, mask_path = self.pairs[idx]
        image = Image.open(img_path).convert("L").resize((self.size, self.size))
        mask  = Image.open(mask_path).convert("L").resize((self.size, self.size))
        img_arr  = np.array(image) / 255.0
        mask_arr = (np.array(mask) > 127).astype(np.float32)
        img_tensor  = torch.tensor(img_arr,  dtype=torch.float32).unsqueeze(0)
        mask_tensor = torch.tensor(mask_arr, dtype=torch.float32).unsqueeze(0)
        return img_tensor, mask_tensor


def collect_pairs(image_dir: str, mask_dir: str, mask_suffix: str = "") -> list:
    """
    Collect (image, mask) file pairs from a directory.
    mask_suffix: extra suffix on mask filename e.g. '_corrected'
    """
    pairs = []
    if not os.path.exists(image_dir) or not os.path.exists(mask_dir):
        return pairs
    images = {f for f in os.listdir(image_dir) if f.lower().endswith(".png")}
    masks  = {f for f in os.listdir(mask_dir)  if f.lower().endswith(".png")}
    for img_file in images:
        stem      = img_file.replace(".png", "")
        mask_file = f"{stem}{mask_suffix}.png"
        if mask_file in masks:
            pairs.append((
                os.path.join(image_dir, img_file),
                os.path.join(mask_dir,  mask_file),
            ))
    return pairs


def build_combined_dataset() -> SegmentationDataset:
    """
    Build training dataset from all expert-reviewed corrections.
    All cases finished by expert reviewer are used to update the model.
    """
    pairs = collect_pairs(
        image_dir=f"{CORRECTIONS_DIR}/images",
        mask_dir=f"{CORRECTIONS_DIR}/masks",
        mask_suffix="",
    )
    print(f"  Expert reviewed pairs : {len(pairs)}")
    return SegmentationDataset(pairs)


def dice_loss(pred: torch.Tensor, target: torch.Tensor, smooth: float = 1.0):
    pred   = torch.sigmoid(pred)
    flat_p = pred.view(-1)
    flat_t = target.view(-1)
    intersection = (flat_p * flat_t).sum()
    return 1 - (2.0 * intersection + smooth) / (flat_p.sum() + flat_t.sum() + smooth)


def finetune_single_model(name: str, cfg: dict, dataset: SegmentationDataset) -> float:
    """Fine-tune one ensemble model on correction data. Returns approximate dice score."""

    model       = cfg["build"]()
    weight_path = os.path.join(WEIGHTS_DIR, cfg["weight"])

    if os.path.exists(weight_path):
        ckpt  = torch.load(weight_path, map_location=DEVICE)
        state = ckpt[cfg["state_key"]] if cfg["state_key"] and isinstance(ckpt, dict) else ckpt
        model.load_state_dict(state, strict=cfg["strict"])
        print(f"  → Loaded existing weights: {cfg['weight']}")
    else:
        print(f"  → No existing weights for {name} — training from scratch")

    model.to(DEVICE)
    model.train()

    loader    = DataLoader(dataset, batch_size=4, shuffle=True)
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)
    criterion = nn.BCEWithLogitsLoss()

    final_loss = 0.0
    for epoch in range(FINETUNE_EPOCHS):
        epoch_loss = 0.0
        for images, masks in loader:
            images = images.to(DEVICE)
            masks  = masks.to(DEVICE)

            optimizer.zero_grad()
            outputs = model(images)
            loss    = criterion(outputs, masks) + dice_loss(outputs, masks)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()

        avg_loss = epoch_loss / max(len(loader), 1)
        print(f"  {name} | Epoch {epoch+1}/{FINETUNE_EPOCHS} | Loss: {avg_loss:.4f}")
        final_loss = avg_loss

    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    torch.save(model.state_dict(), weight_path)
    print(f"  ✓ Saved updated weights: {cfg['weight']}")

    return round(1 - final_loss, 4)


def run_retraining(log_id: str, db_url: str):
    """
    Main retraining function — runs in background.
    Fine-tunes all 5 ensemble models on correction data.
    Updates retraining log in database when complete.
    """
    print(f"\n{'='*50}")
    print(f"RETRAINING STARTED — Log ID: {log_id}")
    print(f"Device: {DEVICE}")
    print(f"{'='*50}\n")

    engine       = create_engine(db_url)
    SessionLocal = sessionmaker(bind=engine)
    db           = SessionLocal()

    try:
        try:
            from models.unet import MODELS
        except ImportError:
            from Models.unet import MODELS
        from database.models import RetrainingLog
        log = db.query(RetrainingLog).filter(RetrainingLog.id == log_id).first()

        dataset = build_combined_dataset()

        print(f"  Dataset size: {len(dataset)} total pairs\n")

        if len(dataset) == 0:
            print("  No correction pairs found — skipping retraining")
            if log:
                log.status       = "failed"
                log.completed_at = datetime.utcnow()
                db.commit()
            return

        dice_scores = []
        for i, (name, cfg) in enumerate(MODELS.items(), 1):
            print(f"\n── Fine-tuning Model {i}/{len(MODELS)}: {name} ──")
            dice = finetune_single_model(name=name, cfg=cfg, dataset=dataset)
            dice_scores.append(dice)

        avg_dice = round(sum(dice_scores) / len(dice_scores), 4)
        print(f"\n{'='*50}")
        print(f"RETRAINING COMPLETE")
        print(f"Average Dice across {len(MODELS)} models: {avg_dice}")
        print(f"{'='*50}\n")

        from routers.predict import ensemble
        ensemble.reload()

        if log:
            log.status              = "completed"
            log.model_version_after = "v2"
            log.dice_after          = avg_dice
            log.completed_at        = datetime.utcnow()
            db.commit()

    except Exception as e:
        print(f"  Retraining failed: {e}")
        try:
            from database.models import RetrainingLog
            log = db.query(RetrainingLog).filter(RetrainingLog.id == log_id).first()
            if log:
                log.status       = "failed"
                log.completed_at = datetime.utcnow()
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
