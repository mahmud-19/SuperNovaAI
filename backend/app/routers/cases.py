import base64
import io
import json
import random
import shutil
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile, status, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image, ImageDraw
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_role
from app.config import get_settings
from app.database import get_db
from app.ml.inference import InferenceOutput, run_inference
from app.models import Annotation, AuditLog, Case, CaseStatus, InferenceResult, ResultSource, User, UserRole, utc_now
from app.schemas import AnnotateRequest, CaseDetail, CaseRead, InferenceResultRead
from app.services.audit import write_audit_log
from app.services.preprocess import preprocess_image, read_validated_upload

router = APIRouter(prefix="/cases", tags=["cases"])


def _display_code(db: Session) -> str:
    while True:
        code = f"{random.randint(1000, 9999)}-{random.randint(1000, 9999)}"
        if db.scalar(select(Case).where(Case.display_code == code)) is None:
            return code


def _current_result(db: Session, case_id: int) -> Optional[InferenceResult]:
    # Try expert result first (highest version)
    expert_res = db.scalar(
        select(InferenceResult)
        .where(InferenceResult.case_id == case_id, InferenceResult.source == ResultSource.expert)
        .order_by(InferenceResult.version.desc())
        .limit(1)
    )
    if expert_res:
        return expert_res
    # Fallback to AI result (highest version)
    return db.scalar(
        select(InferenceResult)
        .where(InferenceResult.case_id == case_id, InferenceResult.source == ResultSource.ai)
        .order_by(InferenceResult.version.desc())
        .limit(1)
    )


def _case_detail(db: Session, case: Case) -> CaseDetail:
    detail = CaseDetail.model_validate(case)
    detail.owner_name = case.uploader_name or (case.owner.full_name if case.owner else None)
    result = _current_result(db, case.id)
    detail.current_result = InferenceResultRead.model_validate(result) if result else None

    # Fetch original AI result
    ai_res = db.scalar(
        select(InferenceResult)
        .where(InferenceResult.case_id == case.id, InferenceResult.source == ResultSource.ai)
        .order_by(InferenceResult.version.asc())
        .limit(1)
    )
    detail.ai_result = InferenceResultRead.model_validate(ai_res) if ai_res else None

    return detail


def _get_visible_case(db: Session, current_user: User, case_id: int) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    if current_user.role == UserRole.sonologist and case.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this case")
    return case


def _ensure_writable(case: Case) -> None:
    if case.is_finalized:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Finalized case is read-only")


def _next_db_version(db: Session, case_id: int) -> int:
    result = _current_result(db, case_id)
    return (result.version if result else 0) + 1


def _store_inference_result(db: Session, case: Case, output: InferenceOutput, source: ResultSource) -> InferenceResult:
    result = InferenceResult(
        case_id=case.id,
        version=_next_db_version(db, case.id),
        source=source,
        mask_path=output.mask_path,
        contour_json=output.contour_json,
        uncertainty_map_path=output.uncertainty_map_path,
        confidence_score=output.confidence_score,
        total_lesions=output.total_lesions,
        total_pixels=output.total_pixels,
    )
    db.add(result)
    return result


@router.post("/upload", response_model=CaseRead)
async def upload_case(
    request: Request,
    file: UploadFile,
    patient_id: Optional[str] = Form(None),
    patient_name: Optional[str] = Form(None),
    age: Optional[int] = Form(None),
    gender: Optional[str] = Form(None),
    exam_date: Optional[date] = Form(None),
    sonologist_note: Optional[str] = Form(None),
    current_user: User = Depends(require_role(UserRole.sonologist)),
    db: Session = Depends(get_db),
) -> Case:
    now = utc_now()
    content, original_format = await read_validated_upload(file)
    if patient_id:
        existing = db.scalar(select(Case).where(Case.patient_id == patient_id))
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This Patient ID already exists")
    case = Case(
        display_code=_display_code(db),
        owner_id=current_user.id,
        uploader_name=current_user.full_name,
        status=CaseStatus.pending,
        original_image_path="pending",
        preprocessed_image_path="pending",
        width=512,
        height=512,
        file_format="PNG",
        bit_depth=8,
        contrast_adjusted=True,
        patient_id=patient_id,
        patient_name=patient_name,
        age=age,
        gender=gender,
        exam_date=exam_date,
        sonologist_note=sonologist_note,
        submitted=False,
        created_at=now,
    )
    db.add(case)
    db.flush()

    case_dir = get_settings().storage_dir / patient_id
    case_dir.mkdir(parents=True, exist_ok=True)

    flat_images_dir = get_settings().storage_dir / "Images"
    flat_images_dir.mkdir(parents=True, exist_ok=True)

    result = preprocess_image(content, original_format, case_dir)
    
    new_preprocessed_path = case_dir / f"{patient_id}.png"
    if result.preprocessed_path != str(new_preprocessed_path):
        shutil.copyfile(result.preprocessed_path, str(new_preprocessed_path))
        try:
            Path(result.preprocessed_path).unlink()
        except Exception:
            pass

    flat_img_path = flat_images_dir / f"{patient_id}.png"
    shutil.copyfile(str(new_preprocessed_path), str(flat_img_path))

    case.original_image_path = result.original_path
    case.preprocessed_image_path = str(flat_img_path)
    case.width = result.width
    case.height = result.height
    case.file_format = result.file_format
    case.bit_depth = result.bit_depth
    case.contrast_adjusted = result.contrast_adjusted
    write_audit_log(db, "upload", user_id=current_user.id, case_id=case.id, ip_address=request.client.host if request.client else None, timestamp=now)
    db.commit()
    db.refresh(case)
    return case


@router.get("/mine", response_model=list[CaseDetail])
def list_my_cases(current_user: User = Depends(require_role(UserRole.sonologist)), db: Session = Depends(get_db)) -> list[CaseDetail]:
    """Return all cases owned by the current sonologist."""
    stmt = select(Case).where(Case.owner_id == current_user.id).order_by(Case.id.desc())
    return [_case_detail(db, case) for case in db.scalars(stmt).all()]


@router.get("", response_model=list[CaseDetail])
def list_cases(current_user: User = Depends(require_role(UserRole.expert_reviewer)), db: Session = Depends(get_db)) -> list[CaseDetail]:
    """Return in-review and approved cases for the Expert Reviewer dashboard."""
    stmt = select(Case).where(Case.status.in_([CaseStatus.in_review, CaseStatus.approved])).order_by(Case.id.desc())
    return [_case_detail(db, case) for case in db.scalars(stmt).all()]


@router.get("/{case_id}", response_model=CaseDetail)
def get_case(case_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> CaseDetail:
    return _case_detail(db, _get_visible_case(db, current_user, case_id))


@router.get("/{case_id}/timeline")
def get_case_timeline(
    case_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = _get_visible_case(db, current_user, case_id)
    stmt = select(AuditLog).where(AuditLog.case_id == case.id).order_by(AuditLog.timestamp.asc())
    logs = db.scalars(stmt).all()

    timeline = []
    for log in logs:
        # Ensure timestamp is UTC-aware before serialising so the JS Date()
        # parser treats it as UTC and the frontend can display it in KST.
        ts = log.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        timeline.append({
            "id": log.id,
            "action": log.action,
            "user_name": log.user.full_name if log.user else "System",
            "user_role": log.user.role if log.user else "system",
            "timestamp": ts.isoformat(),   # e.g. "2026-05-27T09:00:00+00:00"
            "details": log.details
        })
    return timeline



@router.post("/{case_id}/submit", response_model=CaseRead)
def submit_case(
    case_id: int,
    request: Request,
    current_user: User = Depends(require_role(UserRole.sonologist)),
    db: Session = Depends(get_db),
) -> Case:
    """Mark a case as submitted for expert review (submitted=True, status=in_review)."""
    case = _get_visible_case(db, current_user, case_id)
    _ensure_writable(case)
    case.submitted = True
    case.status = CaseStatus.in_review
    write_audit_log(db, "submit_for_review", user_id=current_user.id, case_id=case.id, ip_address=request.client.host if request.client else None)
    db.commit()
    db.refresh(case)
    return case


@router.post("/{case_id}/infer", response_model=InferenceResultRead)
def infer_case(
    case_id: int,
    request: Request,
    current_user: User = Depends(require_role(UserRole.sonologist)),
    db: Session = Depends(get_db),
) -> InferenceResult:
    case = _get_visible_case(db, current_user, case_id)
    _ensure_writable(case)
    output = run_inference(case.preprocessed_image_path)
    result = _store_inference_result(db, case, output, ResultSource.ai)
    # Status stays `pending` until the Expert Reviewer's Final Approval.
    write_audit_log(db, "run_inference", user_id=current_user.id, case_id=case.id, ip_address=request.client.host if request.client else None)
    db.commit()
    db.refresh(result)
    return result


@router.post("/{case_id}/reupload", response_model=InferenceResultRead)
async def reupload_case(
    case_id: int,
    current_user: User = Depends(get_current_user),
) -> InferenceResult:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Reupload is no longer available")


@router.post("/{case_id}/annotate", response_model=InferenceResultRead)
def annotate_case(
    case_id: int,
    payload: AnnotateRequest,
    request: Request,
    current_user: User = Depends(require_role(UserRole.expert_reviewer)),
    db: Session = Depends(get_db),
) -> InferenceResult:
    case = _get_visible_case(db, current_user, case_id)
    _ensure_writable(case)
    version = _next_db_version(db, case.id)
    encoded = payload.mask_png_base64.split(",", 1)[-1]
    try:
        mask_bytes = base64.b64decode(encoded)
        mask = Image.open(io.BytesIO(mask_bytes)).convert("L").resize((512, 512))
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid mask PNG data")

    case_dir = get_settings().storage_dir / case.patient_id
    case_dir.mkdir(parents=True, exist_ok=True)
    
    # Save directly to expert mask storage path storage/<patient_id>/mask_<patient_id>.png
    expert_mask_path = case_dir / f"mask_{case.patient_id}.png"
    mask.save(expert_mask_path, format="PNG")

    # Recompute uncertainty heatmap
    try:
        import cv2
        import numpy as np
        from app.ml.inference import _boundary_band, _boundary_uncertainty, _normalise_in_band, _colormap_rgba

        mask_arr = np.array(mask, dtype=np.uint8)
        pred_binary = (mask_arr > 127).astype(np.uint8)
        
        # v19 boundary band (outer_px=3, inner_px=0)
        band = _boundary_band(pred_binary, outer_px=3, inner_px=0)
        
        # Smooth probability map via Gaussian Blur
        blur = cv2.GaussianBlur(mask_arr.astype(np.float32) / 255.0, (21, 21), 5)
        mean_512 = np.clip(blur, 0.0, 1.0)
        
        var_map = 0.25 - np.square(mean_512 - 0.5)
        uncertainty = _boundary_uncertainty(mean_512, var_map)
        
        eps = 1e-7
        p_c = np.clip(mean_512, eps, 1.0 - eps)
        entropy_raw = -(p_c * np.log2(p_c) + (1.0 - p_c) * np.log2(1.0 - p_c))
        unc_norm = _normalise_in_band(uncertainty, band, entropy_raw)
        
        heatmap_colors = _colormap_rgba(unc_norm, band)
        has_heatmap = True
    except Exception as e:
        import logging
        logging.getLogger("supernova.cases").error(f"Failed to recompute expert uncertainty: {e}")
        has_heatmap = False

    # Check if an expert inference result already exists
    current_expert = db.scalar(
        select(InferenceResult)
        .where(InferenceResult.case_id == case.id, InferenceResult.source == ResultSource.expert)
        .order_by(InferenceResult.version.desc())
        .limit(1)
    )

    if current_expert:
        # Overwrite existing files
        mask_path = Path(current_expert.mask_path)
        mask.save(mask_path, format="PNG")
        
        heatmap_path = Path(current_expert.uncertainty_map_path)
        if has_heatmap:
            Image.fromarray(heatmap_colors, mode="RGBA").save(heatmap_path, format="PNG")
        
        pixels = int((Image.open(mask_path).convert("L").point(lambda p: 255 if p else 0)).histogram()[255])
        total_lesions = max(1, len(payload.contour_json)) if pixels else 0
        confidence = 0.84 if pixels else 0.0

        current_expert.contour_json = payload.contour_json
        current_expert.total_pixels = pixels
        current_expert.total_lesions = total_lesions
        current_expert.confidence_score = confidence

        # Also update the latest Annotation row
        ann = db.scalar(
            select(Annotation)
            .where(Annotation.case_id == case.id)
            .order_by(Annotation.created_at.desc())
            .limit(1)
        )
        if ann:
            ann.contour_json = payload.contour_json
            ann.mask_path = str(mask_path)
        
        result = current_expert
    else:
        # Create a new InferenceResult and Annotation
        version = _next_db_version(db, case.id)
        mask_path = case_dir / f"mask_v{version}.png"
        mask.save(mask_path, format="PNG")
        
        heatmap_path = case_dir / f"heatmap_v{version}.png"
        if has_heatmap:
            Image.fromarray(heatmap_colors, mode="RGBA").save(heatmap_path, format="PNG")
        else:
            Image.new("RGBA", (512, 512), (0, 0, 0, 0)).save(heatmap_path, format="PNG")
            
        pixels = int((Image.open(mask_path).convert("L").point(lambda p: 255 if p else 0)).histogram()[255])
        total_lesions = max(1, len(payload.contour_json)) if pixels else 0
        confidence = 0.84 if pixels else 0.0

        db.add(
            Annotation(
                case_id=case.id,
                editor_id=current_user.id,
                mask_path=str(mask_path),
                contour_json=payload.contour_json,
                confidence_map_path=str(heatmap_path),
                is_finalized=False,
            )
        )
        result = InferenceResult(
            case_id=case.id,
            version=version,
            source=ResultSource.expert,
            mask_path=str(mask_path),
            contour_json=payload.contour_json,
            uncertainty_map_path=str(heatmap_path),
            confidence_score=confidence,
            total_lesions=total_lesions,
            total_pixels=pixels,
        )
        db.add(result)
    # Save reviewer note if provided
    if payload.reviewer_note is not None:
        case.reviewer_note = payload.reviewer_note
    # Status stays `pending`; only Final Approval flips it to `approved`.
    write_audit_log(db, "reannotate", user_id=current_user.id, case_id=case.id, ip_address=request.client.host if request.client else None)
    db.commit()
    db.refresh(result)
    return result


@router.post("/{case_id}/finalize", response_model=CaseRead)
def finalize_case(
    case_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_role(UserRole.expert_reviewer)),
    db: Session = Depends(get_db),
) -> Case:
    import uuid
    import time
    from app.models import RetrainingState, RetrainingLog
    from retrain import run_retraining

    case = _get_visible_case(db, current_user, case_id)
    if case.is_finalized:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Case is already finalized")
    result = _current_result(db, case.id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Run inference before final approval")

    # Save approved mask directly to storage/<patient_id>/mask_<patient_id>.png
    case_dir = get_settings().storage_dir / case.patient_id
    new_mask_path = case_dir / f"mask_{case.patient_id}.png"

    # Also save to storage/Masks/mask_<patient_id>.png
    flat_masks_dir = get_settings().storage_dir / "Masks"
    flat_masks_dir.mkdir(parents=True, exist_ok=True)
    flat_mask_path = flat_masks_dir / f"mask_{case.patient_id}.png"

    old_mask_path = Path(result.mask_path)
    if old_mask_path.exists():
        if old_mask_path != new_mask_path:
            shutil.copyfile(str(old_mask_path), str(new_mask_path))
    else:
        case_dir_mask = case_dir / old_mask_path.name
        if case_dir_mask.exists():
            shutil.copyfile(str(case_dir_mask), str(new_mask_path))
        else:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Segmentation mask file not found")

    # Copy to flat Masks path (overwriting if it exists)
    shutil.copyfile(str(new_mask_path), str(flat_mask_path))

    result.mask_path = str(flat_mask_path)

    ann = db.scalar(
        select(Annotation)
        .where(Annotation.case_id == case.id)
        .order_by(Annotation.created_at.desc())
        .limit(1)
    )
    if ann:
        ann.mask_path = str(flat_mask_path)

    case.is_finalized = True
    case.status = CaseStatus.approved
    write_audit_log(db, "finalize", user_id=current_user.id, case_id=case.id, ip_address=request.client.host if request.client else None)

    # --- Human-in-the-loop Retraining Integration ---
    corrections_dir = Path("corrections")
    corr_images = corrections_dir / "images"
    corr_masks = corrections_dir / "masks"
    corr_images.mkdir(parents=True, exist_ok=True)
    corr_masks.mkdir(parents=True, exist_ok=True)

    # 1. Generate and save reannotated image to corrections/images/<patient_id>.png
    if case.preprocessed_image_path and Path(case.preprocessed_image_path).exists():
        try:
            reann_img = _draw_contours_from_mask(case.preprocessed_image_path, str(flat_mask_path))
            reann_img.save(str(corr_images / f"{case.patient_id}.png"), format="PNG")
        except Exception as e:
            import logging
            logging.getLogger("supernova.cases").error(f"Failed to generate reannotated correction image: {e}")
            shutil.copyfile(case.preprocessed_image_path, str(corr_images / f"{case.patient_id}.png"))

    # 2. Copy approved mask to corrections/masks/<patient_id>.png
    if flat_mask_path.exists():
        shutil.copyfile(str(flat_mask_path), str(corr_masks / f"{case.patient_id}.png"))

    # 3. Update retraining state counter
    state = db.scalar(select(RetrainingState).where(RetrainingState.id == 1))
    if not state:
        state = RetrainingState(id=1, approved_since_last_retrain=0)
        db.add(state)

    state.approved_since_last_retrain += 1

    # 4. Trigger background retraining if counter hits 100
    if state.approved_since_last_retrain >= 100:
        state.approved_since_last_retrain = 0

        # Create RetrainingLog
        log_id = f"retrain_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        new_log = RetrainingLog(
            id=log_id,
            status="running",
        )
        db.add(new_log)
        db.commit()

        # Spawn retraining thread via FastAPI background task
        background_tasks.add_task(run_retraining, log_id, get_settings().database_url)
    else:
        db.commit()

    db.refresh(case)
    return case


def _wrap_text(text: str, max_chars: int) -> list[str]:
    lines = []
    for line in text.split("\n"):
        while len(line) > max_chars:
            split_idx = line.rfind(" ", 0, max_chars)
            if split_idx == -1:
                split_idx = max_chars
            lines.append(line[:split_idx])
            line = line[split_idx:].lstrip()
        lines.append(line)
    return lines


def _draw_contours_on_image(image_path: str, contour_json: list) -> Image.Image:
    img = Image.open(image_path).convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for poly in contour_json:
        if len(poly) < 2:
            continue
        points = [(float(pt[0]), float(pt[1])) for pt in poly]
        points_closed = points + [points[0]]
        if len(points) >= 3:
            draw.polygon(points, fill=(16, 185, 129, 30))
        draw.line(points_closed, fill=(16, 185, 129, 255), width=3)
    
    combined = Image.alpha_composite(img, overlay)
    return combined.convert("RGB")


@router.get("/{case_id}/report")
def report_case(
    case_id: int,
    request: Request,
    report_type: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    case = _get_visible_case(db, current_user, case_id)
    result = _current_result(db, case.id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No result exists for report export")

    stream = io.BytesIO()
    pdf = canvas.Canvas(stream, pagesize=letter, pageCompression=0)
    page_width, page_height = letter
    margin = 0.5 * inch

    pdf.setTitle(f"SuperNova_Report_{case.patient_name or case.id}")
    
    # 1. Header
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(margin, page_height - margin, "SuperNova AI — Ultrasound Lesion Boundary Detection Report")
    
    if current_user.role == UserRole.expert_reviewer or report_type == "reviewer":
        pdf.setFont("Helvetica-BoldOblique", 11)
        pdf.setFillColor(colors.HexColor("#2760c6"))
        pdf.drawString(margin, page_height - margin - 18, "Final Outcome by Expert Reviewer")
        pdf.setFillColor(colors.black)
        
        y_line = page_height - margin - 26
        y_details = page_height - margin - 43
    else:
        y_line = page_height - margin - 8
        y_details = page_height - margin - 25

    pdf.setFont("Helvetica", 9)
    pdf.line(margin, y_line, page_width - margin, y_line)
    
    # 2. Details Grid
    
    # Left Column: Patient Details
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(margin, y_details, "Patient Details")
    pdf.setFont("Helvetica", 9)
    
    gender_str = case.gender.capitalize() if case.gender else "—"
    
    from datetime import timedelta
    utc_dt = case.created_at
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=timezone.utc)
    kst_dt = utc_dt.astimezone(timezone(timedelta(hours=9)))
    upload_date_str = kst_dt.strftime("%Y-%m-%d")
    
    p_details = [
        ("Patient ID:", case.patient_id or "—"),
        ("Patient Name:", case.patient_name or "—"),
        ("Age:", f"{case.age} yrs" if case.age is not None else "—"),
        ("Gender:", gender_str),
        ("Date:", upload_date_str),
        ("Sonologist:", case.uploader_name or (case.owner.full_name if case.owner else "—")),
    ]
    for i, (label, val) in enumerate(p_details):
        y = y_details - 16 - i * 14
        pdf.drawString(margin + 5, y, label)
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(margin + 90, y, val)
        pdf.setFont("Helvetica", 9)
        
    # Right Column: Outcome Summary
    summary_x = page_width / 2 + 10
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(summary_x, y_details, "Outcome Summary")
    pdf.setFont("Helvetica", 9)
    
    if result.source == ResultSource.expert:
        conf_label = "Confidence:"
        conf_str = "Expert Verified"
    else:
        conf_label = "AI Confidence %:"
        conf_str = f"{round(result.confidence_score * 100)}%"
        
    res_str = f"{case.width}x{case.height} px | {case.file_format} 8-bit"
    
    o_summary = [
        ("Total Lesions:", str(result.total_lesions)),
        ("Total Pixels:", f"{result.total_pixels:,}"),
        (conf_label, conf_str),
        ("Resolution/Format:", res_str),
    ]
    for i, (label, val) in enumerate(o_summary):
        y = y_details - 16 - i * 14
        pdf.drawString(summary_x + 5, y, label)
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(summary_x + 110, y, val)
        pdf.setFont("Helvetica", 9)
        
    # Draw horizontal divider
    y_divider1 = y_details - 95
    pdf.line(margin, y_divider1, page_width - margin, y_divider1)
    
    # 3. Three Images Row
    img_size = 160
    gap = 30
    y_images_title = y_divider1 - 18
    y_images = y_images_title - img_size - 12
    
    if report_type == "reviewer":
        # Raw Ultrasound image
        x_raw = margin
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(x_raw, y_images_title, "1. Raw Ultrasound")
        pdf.drawImage(case.preprocessed_image_path, x_raw, y_images, width=img_size, height=img_size, preserveAspectRatio=True)
        
        # Reannotated Image (middle panel)
        x_reann = margin + img_size + gap
        pdf.drawString(x_reann, y_images_title, "2. Reannotated Image")
        try:
            from reportlab.lib.utils import ImageReader
            # Resolve mask path for reannotation
            case_dir = get_settings().storage_dir / case.patient_id
            expert_mask_path = case_dir / f"mask_{case.patient_id}.png"
            mask_path = None
            if expert_mask_path.exists():
                mask_path = str(expert_mask_path)
            else:
                result_fallback = _current_result(db, case.id)
                if result_fallback and Path(result_fallback.mask_path).exists():
                    mask_path = result_fallback.mask_path
            
            if mask_path:
                reann_img = _draw_contours_from_mask(case.preprocessed_image_path, mask_path)
            else:
                reann_img = Image.open(case.preprocessed_image_path)
                
            pdf.drawImage(ImageReader(reann_img), x_reann, y_images, width=img_size, height=img_size, preserveAspectRatio=True)
        except Exception as e:
            import logging
            logging.getLogger("supernova.cases").error(f"Failed to draw reannotated image in PDF: {e}")
            pdf.drawImage(case.preprocessed_image_path, x_reann, y_images, width=img_size, height=img_size, preserveAspectRatio=True)
            
        # Segmented Mask (right panel)
        x_mask = margin + 2 * (img_size + gap)
        pdf.drawString(x_mask, y_images_title, "3. Segmented Mask")
        pdf.drawImage(result.mask_path, x_mask, y_images, width=img_size, height=img_size, preserveAspectRatio=True)
        
        # Draw horizontal divider (no legend)
        y_divider2 = y_images - 12
        pdf.line(margin, y_divider2, page_width - margin, y_divider2)
        
    else:
        # Sonologist Report (default / "sonologist")
        # Raw Ultrasound image
        x_raw = margin
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(x_raw, y_images_title, "1. Raw Ultrasound")
        pdf.drawImage(case.preprocessed_image_path, x_raw, y_images, width=img_size, height=img_size, preserveAspectRatio=True)
        
        # Segmented Mask (middle panel)
        x_mask = margin + img_size + gap
        pdf.drawString(x_mask, y_images_title, "2. Segmented Mask")
        pdf.drawImage(result.mask_path, x_mask, y_images, width=img_size, height=img_size, preserveAspectRatio=True)
        
        # Uncertainty Heatmap (right panel)
        x_heat = margin + 2 * (img_size + gap)
        pdf.drawString(x_heat, y_images_title, "3. Uncertainty Heatmap")
        pdf.drawImage(case.preprocessed_image_path, x_heat, y_images, width=img_size, height=img_size, preserveAspectRatio=True)
        pdf.drawImage(result.uncertainty_map_path, x_heat, y_images, width=img_size, height=img_size, preserveAspectRatio=True, mask="auto")
        
        # Confidence Level Legend
        y_legend = y_images - 22
        pdf.setFont("Helvetica", 8)
        pdf.setFillColor(colors.HexColor("#5f6f7a"))
        pdf.drawString(margin, y_legend, "Confidence Level Legend: Low (Blue/Green)  --  Moderate (Green/Yellow)  --  High (Red)")
        pdf.setFillColor(colors.black)
        
        # Draw horizontal divider
        y_divider2 = y_legend - 8
        pdf.line(margin, y_divider2, page_width - margin, y_divider2)
    
    # 5. Notes Section
    y_notes = y_divider2 - 16
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(margin, y_notes, "Clinical Notes")
    
    y_current = y_notes - 15
    if case.sonologist_note:
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(margin + 5, y_current, "Sonologist Observations:")
        pdf.setFont("Helvetica", 9)
        note_lines = _wrap_text(case.sonologist_note, 90)
        for line in note_lines:
            y_current -= 12
            pdf.drawString(margin + 15, y_current, line)
        y_current -= 12
        
    if case.reviewer_note:
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(margin + 5, y_current, "Expert Reviewer Comments:")
        pdf.setFont("Helvetica", 9)
        note_lines = _wrap_text(case.reviewer_note, 90)
        for line in note_lines:
            y_current -= 12
            pdf.drawString(margin + 15, y_current, line)
            
    # 6. Footer
    pdf.setFont("Helvetica", 8)
    pdf.setFillColor(colors.HexColor("#7f8c8d"))
    pdf.drawString(margin, 0.4 * inch, "Generated by SuperNova AI Clinical Ultrasound Analysis Service")
    pdf.drawRightString(page_width - margin, 0.4 * inch, "For clinical research and education only")
    
    pdf.save()
    stream.seek(0)
    
    write_audit_log(db, "report_export", user_id=current_user.id, case_id=case.id, ip_address=request.client.host if request.client else None)
    db.commit()
    
    is_reviewer = current_user.role == UserRole.expert_reviewer or report_type == "reviewer"
    kind = "Reviewer" if is_reviewer else "Sonologist"
    safe_name = case.patient_name.replace(" ", "_") if case.patient_name else case.id
    filename = f"SuperNova_{kind}_Report_{safe_name}.pdf"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(stream, media_type="application/pdf", headers=headers)


@router.get("/{case_id}/export")
def export_case(
    case_id: int,
    request: Request,
    report_type: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    # ZIP export replaced with upgraded PDF final report
    r_type = report_type or "reviewer"
    return report_case(case_id, request, report_type=r_type, current_user=current_user, db=db)


def _serve_path(path_value: str) -> FileResponse:
    path = Path(path_value)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return FileResponse(path)


@router.get("/{case_id}/image")
def get_image(case_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> FileResponse:
    case = _get_visible_case(db, current_user, case_id)
    return _serve_path(case.preprocessed_image_path)


def _draw_contours_from_mask(image_path: str, mask_path: str) -> Image.Image:
    img = Image.open(image_path).convert("RGBA")
    mask_p = Path(mask_path)
    if not mask_p.exists():
        return img.convert("RGB")
        
    import cv2
    import numpy as np
    
    mask_cv = cv2.imread(str(mask_p), cv2.IMREAD_GRAYSCALE)
    if mask_cv is None:
        return img.convert("RGB")
        
    _, thresh = cv2.threshold(mask_cv, 127, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    for cnt in contours:
        if len(cnt) < 2:
            continue
        points = [(float(pt[0][0]), float(pt[0][1])) for pt in cnt]
        points_closed = points + [points[0]]
        if len(points) >= 3:
            draw.polygon(points, fill=(16, 185, 129, 30))
        draw.line(points_closed, fill=(16, 185, 129, 255), width=3)
        
    combined = Image.alpha_composite(img, overlay)
    return combined.convert("RGB")


@router.get("/{case_id}/reannotated.png")
def get_reannotated_image(
    case_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = _get_visible_case(db, current_user, case_id)
    
    case_dir = get_settings().storage_dir / case.patient_id
    expert_mask_path = case_dir / f"mask_{case.patient_id}.png"
    
    mask_path = None
    if expert_mask_path.exists():
        mask_path = str(expert_mask_path)
    else:
        result = _current_result(db, case.id)
        if result and Path(result.mask_path).exists():
            mask_path = result.mask_path
            
    if not mask_path:
        return FileResponse(case.preprocessed_image_path)
        
    try:
        reann_img = _draw_contours_from_mask(case.preprocessed_image_path, mask_path)
        img_io = io.BytesIO()
        reann_img.save(img_io, format="PNG")
        img_io.seek(0)
        return StreamingResponse(img_io, media_type="image/png")
    except Exception as e:
        import logging
        logging.getLogger("supernova.cases").error(f"Failed to generate reannotated.png: {e}")
        return FileResponse(case.preprocessed_image_path)


@router.get("/{case_id}/mask")
def get_mask(
    case_id: int,
    source: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    _get_visible_case(db, current_user, case_id)
    if source is not None:
        result = db.scalar(
            select(InferenceResult)
            .where(InferenceResult.case_id == case_id, InferenceResult.source == source)
            .order_by(InferenceResult.version.asc())
            .limit(1)
        )
    else:
        result = _current_result(db, case_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No mask exists for this case yet")
    return _serve_path(result.mask_path)


@router.get("/{case_id}/heatmap")
def get_heatmap(
    case_id: int,
    source: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    _get_visible_case(db, current_user, case_id)
    if source is not None:
        result = db.scalar(
            select(InferenceResult)
            .where(InferenceResult.case_id == case_id, InferenceResult.source == source)
            .order_by(InferenceResult.version.asc())
            .limit(1)
        )
    else:
        result = _current_result(db, case_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No heatmap exists for this case yet")
    return _serve_path(result.uncertainty_map_path)
