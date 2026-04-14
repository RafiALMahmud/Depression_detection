from pydantic import BaseModel, ConfigDict, Field


class MoodScore(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    confidence: float = Field(ge=0.0, le=1.0)


class FrameMoodPrediction(BaseModel):
    frame_index: int = Field(ge=0)
    dominant_label: str = Field(min_length=1, max_length=80)
    dominant_confidence: float = Field(ge=0.0, le=1.0)
    scores: list[MoodScore]


class VisionPredictionResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model_name: str = Field(min_length=1, max_length=200)
    frame_count: int = Field(ge=1)
    dominant_label: str = Field(min_length=1, max_length=80)
    dominant_confidence: float = Field(ge=0.0, le=1.0)
    averaged_scores: list[MoodScore]
    frames: list[FrameMoodPrediction]


class VisionModelStatusResponse(BaseModel):
    ready: bool
    message: str = Field(min_length=1, max_length=600)
    architecture: str = Field(min_length=1, max_length=80)
    weights_path: str = Field(min_length=1, max_length=500)
    weights_found: bool
    input_size: int = Field(ge=1)
    max_frames_per_request: int = Field(ge=1)
    class_labels: list[str]
    load_error: str | None = None
