from datetime import date, datetime, timezone
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, PlainSerializer

def serialize_datetime(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")

UTCDateTime = Annotated[datetime, PlainSerializer(serialize_datetime, return_type=str)]


Role = Literal["sonologist", "expert_reviewer", "admin"]


class LoginRequest(BaseModel):
    identifier: str
    password: str
    role: Role


class UserRead(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    username: str
    role: Role

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    user: UserRead


class CaseRead(BaseModel):
    id: int
    display_code: str
    status: str
    owner_name: Optional[str] = None
    width: int
    height: int
    file_format: str
    bit_depth: int
    contrast_adjusted: bool
    is_finalized: bool
    # Patient / exam metadata
    patient_id: Optional[str] = None
    patient_name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    exam_date: Optional[date] = None
    sonologist_note: Optional[str] = None
    reviewer_note: Optional[str] = None
    submitted: bool = False
    created_at: UTCDateTime
    updated_at: UTCDateTime

    model_config = ConfigDict(from_attributes=True)


class InferenceResultRead(BaseModel):
    id: int
    case_id: int
    version: int
    source: str
    contour_json: list[Any]
    confidence_score: float
    total_lesions: int
    total_pixels: int
    created_at: UTCDateTime

    model_config = ConfigDict(from_attributes=True)


class CaseDetail(CaseRead):
    current_result: Optional[InferenceResultRead] = None
    ai_result: Optional[InferenceResultRead] = None


class AnnotateRequest(BaseModel):
    contour_json: list[list[list[float]]]
    mask_png_base64: str
    reviewer_note: Optional[str] = None


class UserCreate(BaseModel):
    full_name: str
    username: str
    email: EmailStr
    password: str
    role: Literal["sonologist", "expert_reviewer"]


class UserUpdate(BaseModel):
    full_name: str
    username: str
    email: EmailStr
    password: Optional[str] = None
    role: Literal["sonologist", "expert_reviewer"]


class AdminUserRead(BaseModel):
    id: int
    full_name: str
    username: str
    email: EmailStr
    role: str
    created_at: UTCDateTime

    model_config = ConfigDict(from_attributes=True)
