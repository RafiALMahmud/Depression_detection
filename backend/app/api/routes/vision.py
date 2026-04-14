from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from app.api.deps import require_roles
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.vision import VisionModelStatusResponse, VisionPredictionResponse
from app.services.vision import (
    InvalidVisionInputError,
    VisionInferenceError,
    VisionModelNotReadyError,
    get_vision_inference_service,
)
from app.services.vision.inference import VisionInferenceService

router = APIRouter(prefix="/vision", tags=["Vision"])


@router.get("/status", response_model=VisionModelStatusResponse, status_code=status.HTTP_200_OK)
def get_model_status(
    _: User = Depends(require_roles(UserRole.EMPLOYEE)),
    service: VisionInferenceService = Depends(get_vision_inference_service),
) -> VisionModelStatusResponse:
    return VisionModelStatusResponse.model_validate(service.get_status())


@router.post("/predict", response_model=VisionPredictionResponse, status_code=status.HTTP_200_OK)
async def predict_mood(
    frames: list[UploadFile] = File(..., description="One or more webcam frames captured during a check-in."),
    top_k: int = Query(default=3, ge=1, le=10),
    _: User = Depends(require_roles(UserRole.EMPLOYEE)),
    service: VisionInferenceService = Depends(get_vision_inference_service),
) -> VisionPredictionResponse:
    if not frames:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one frame is required")
    if len(frames) > service.max_frames_per_request:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum {service.max_frames_per_request} frames are allowed per request",
        )

    frame_payloads: list[bytes] = []
    for frame in frames:
        if frame.content_type and not frame.content_type.startswith("image/"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported content type '{frame.content_type}'. Only image uploads are allowed.",
            )
        frame_payloads.append(await frame.read())

    try:
        payload = service.predict_batch(frame_payloads, top_k=top_k)
    except InvalidVisionInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except VisionModelNotReadyError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except VisionInferenceError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    return VisionPredictionResponse.model_validate(payload)
