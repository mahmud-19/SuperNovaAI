import sys
from pathlib import Path
# Ensure root repository is in python path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.routers import auth, cases, admin
from app.seed import seed_demo_users


settings = get_settings()
app = FastAPI(title="SuperNova AI API", version="0.1.0")
cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Refreshed-Token"],
)


@app.middleware("http")
async def attach_refreshed_token(request: Request, call_next):
    response = await call_next(request)
    refreshed = getattr(request.state, "refreshed_token", None)
    if refreshed:
        response.headers["X-Refreshed-Token"] = refreshed
    return response


from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    if "/admin/users" in request.url.path:
        return JSONResponse(
            status_code=400,
            content={"detail": "All fields are required and must be valid"},
        )
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )


def ensure_initial_weights() -> None:
    import shutil
    from pathlib import Path
    project_dir = Path(__file__).resolve().parent.parent.parent
    legacy_dir = project_dir / "Models"
    weights_dir = project_dir / "models" / "weights"
    weights_dir.mkdir(parents=True, exist_ok=True)

    mappings = [
        (legacy_dir / "attention  unet model" / "checkpoints" / "best_attention_unet.pth", weights_dir / "attention_unet.pth"),
        (legacy_dir / "BaseUnet" / "best_base_unet.pth", weights_dir / "base_unet.pth"),
        (legacy_dir / "DeepLab V3+" / "checkpoints" / "best_model.pth", weights_dir / "deeplabv3.pth"),
        (legacy_dir / "MobileVnet3" / "best_model.pth", weights_dir / "mobilenetv3.pth"),
    ]
    for src, dst in mappings:
        if src.exists() and not dst.exists():
            shutil.copyfile(str(src), str(dst))


def migrate_to_v17_layout() -> None:
    import shutil
    from pathlib import Path
    from sqlalchemy import select
    from app.models import Case, InferenceResult, Annotation, CaseStatus

    storage_dir = settings.storage_dir
    flat_images_dir = storage_dir / "Images"
    flat_masks_dir = storage_dir / "Masks"
    flat_images_dir.mkdir(parents=True, exist_ok=True)
    flat_masks_dir.mkdir(parents=True, exist_ok=True)

    with SessionLocal() as db:
        cases = db.scalars(select(Case)).all()
        for case in cases:
            if not case.patient_id:
                continue

            # Target directory: storage/<patient_id>/
            target_dir = storage_dir / case.patient_id
            target_dir.mkdir(parents=True, exist_ok=True)

            # 1. Migrate old numeric directory if it exists: storage/<case_id>/
            old_numeric_dir = storage_dir / str(case.id)
            if old_numeric_dir.exists() and old_numeric_dir.is_dir():
                for f in old_numeric_dir.iterdir():
                    if f.is_file():
                        shutil.move(str(f), str(target_dir / f.name))
                try:
                    old_numeric_dir.rmdir()
                except Exception:
                    pass

            # 2. Check for preprocessed image files in new target folder or legacy flat folders
            legacy_flat_img = flat_images_dir / f"{case.patient_id}.png"
            new_img_path = target_dir / f"{case.patient_id}.png"

            # If we moved preprocessed.png from numeric folder, rename it
            if (target_dir / "preprocessed.png").exists():
                if new_img_path.exists():
                    (target_dir / "preprocessed.png").unlink()
                else:
                    (target_dir / "preprocessed.png").rename(new_img_path)

            # Ensure the preprocessed image is present in BOTH locations
            if legacy_flat_img.exists() and not new_img_path.exists():
                shutil.copyfile(str(legacy_flat_img), str(new_img_path))
            elif new_img_path.exists() and not legacy_flat_img.exists():
                shutil.copyfile(str(new_img_path), str(legacy_flat_img))

            # Update paths in database
            if case.original_image_path and "storage/" in case.original_image_path:
                orig_name = Path(case.original_image_path).name
                if (target_dir / orig_name).exists():
                    case.original_image_path = str(target_dir / orig_name)

            if legacy_flat_img.exists():
                case.preprocessed_image_path = str(legacy_flat_img)

            # 3. Migrate mask files
            legacy_flat_mask = flat_masks_dir / f"mask_{case.patient_id}.png"
            new_mask_path = target_dir / f"mask_{case.patient_id}.png"

            if legacy_flat_mask.exists() and not new_mask_path.exists():
                shutil.copyfile(str(legacy_flat_mask), str(new_mask_path))
            elif new_mask_path.exists() and not legacy_flat_mask.exists():
                shutil.copyfile(str(new_mask_path), str(legacy_flat_mask))

            # Update all InferenceResult and Annotation records for this case
            results = db.scalars(select(InferenceResult).where(InferenceResult.case_id == case.id)).all()
            for res in results:
                old_path = Path(res.mask_path)
                res_target = target_dir / old_path.name
                
                # If old path exists (like in some numeric path or old folder), move it to target_dir first
                if old_path.exists() and old_path != res_target and old_path != new_mask_path and old_path != legacy_flat_mask:
                    shutil.move(str(old_path), str(res_target))

                # Identify if this was the finalized/approved mask
                is_final_version = False
                latest_res = db.scalar(
                    select(InferenceResult)
                    .where(InferenceResult.case_id == case.id)
                    .order_by(InferenceResult.version.desc())
                    .limit(1)
                )
                if latest_res and res.id == latest_res.id and case.status == CaseStatus.approved:
                    is_final_version = True

                if is_final_version:
                    # Make sure the approved mask is named mask_<patient_id>.png in target_dir
                    if res_target.exists() and not new_mask_path.exists():
                        res_target.rename(new_mask_path)
                    
                    # Make sure it's copied to legacy flat path
                    if new_mask_path.exists() and not legacy_flat_mask.exists():
                        shutil.copyfile(str(new_mask_path), str(legacy_flat_mask))
                    elif legacy_flat_mask.exists() and not new_mask_path.exists():
                        shutil.copyfile(str(legacy_flat_mask), str(new_mask_path))

                    # The database points to the legacy flat mask path!
                    res.mask_path = str(legacy_flat_mask)
                else:
                    if res_target.exists():
                        res.mask_path = str(res_target)
                    elif new_mask_path.exists() and "mask_" in old_path.name:
                        res.mask_path = str(new_mask_path)

                # Update uncertainty map path (heatmap)
                old_unc_path = Path(res.uncertainty_map_path)
                unc_target = target_dir / old_unc_path.name
                if old_unc_path.exists() and old_unc_path != unc_target:
                    shutil.move(str(old_unc_path), str(unc_target))
                if unc_target.exists():
                    res.uncertainty_map_path = str(unc_target)

            annotations = db.scalars(select(Annotation).where(Annotation.case_id == case.id)).all()
            for ann in annotations:
                old_path = Path(ann.mask_path)
                ann_target = target_dir / old_path.name
                if old_path.exists() and old_path != ann_target and old_path != new_mask_path and old_path != legacy_flat_mask:
                    shutil.move(str(old_path), str(ann_target))

                if case.status == CaseStatus.approved:
                    ann.mask_path = str(legacy_flat_mask)
                else:
                    if ann_target.exists():
                        ann.mask_path = str(ann_target)

                if ann.confidence_map_path:
                    old_conf_path = Path(ann.confidence_map_path)
                    conf_target = target_dir / old_conf_path.name
                    if old_conf_path.exists() and old_conf_path != conf_target:
                        shutil.move(str(old_conf_path), str(conf_target))
                    if conf_target.exists():
                        ann.confidence_map_path = str(conf_target)

        db.commit()


@app.on_event("startup")
def startup() -> None:
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / "Images").mkdir(parents=True, exist_ok=True)
    (settings.storage_dir / "Masks").mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_demo_users(db)
    ensure_initial_weights()
    migrate_to_v17_layout()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api")
app.include_router(cases.router, prefix="/api")
app.include_router(admin.router, prefix="/api")

# ---------------------------------------------------------------------------
# Serve the React frontend (production build)
# When running as a bundled desktop app, SUPERNOVA_BASE_DIR is set by launcher.py
# so that paths resolve correctly regardless of working directory.
# ---------------------------------------------------------------------------
import os as _os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

_base_dir = Path(_os.environ.get(
    "SUPERNOVA_BASE_DIR",
    str(Path(__file__).resolve().parent.parent.parent)
))
_dist_dir = _base_dir / "frontend" / "dist"

if _dist_dir.exists():
    # Serve static assets (JS/CSS bundles)
    _assets_dir = _dist_dir / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="static-assets")

    # SPA catch-all: serve index.html for every non-API path so React Router works
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        return FileResponse(str(_dist_dir / "index.html"))
