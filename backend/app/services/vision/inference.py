from functools import lru_cache
from pathlib import Path
from threading import Lock
from typing import Any

import torch
from torch import Tensor, nn

from app.core.config import settings
from app.services.vision.model import build_classifier_model, iter_state_dict_candidates
from app.services.vision.preprocess import InvalidImagePayloadError, preprocess_image_bytes

PROJECT_ROOT_DIR = Path(__file__).resolve().parents[4]


class VisionInferenceError(RuntimeError):
    pass


class VisionModelNotReadyError(VisionInferenceError):
    pass


class InvalidVisionInputError(VisionInferenceError):
    pass


class VisionInferenceService:
    def __init__(self) -> None:
        self._architecture = settings.vision_model_architecture
        self._class_labels = settings.vision_class_labels_list
        self._classifier_hidden_dim = settings.vision_classifier_hidden_dim
        self._input_size = settings.vision_input_size
        self._max_frames_per_request = settings.vision_max_frames_per_request
        self._strict_model_load = settings.vision_strict_model_load
        self._weights_path = self._resolve_weights_path(settings.vision_model_weights_path)
        self._device = torch.device("cpu")
        self._model: nn.Module | None = None
        self._load_lock = Lock()

    @property
    def max_frames_per_request(self) -> int:
        return self._max_frames_per_request

    def get_status(self) -> dict[str, Any]:
        weights_found = self._weights_path.exists()
        load_error: str | None = None
        ready = False
        message = (
            f"Vision weights file was not found at '{self._weights_path}'. "
            "Place the checkpoint there or update VISION_MODEL_WEIGHTS_PATH."
        )

        if weights_found:
            try:
                self._ensure_model_loaded()
                ready = True
                message = "Vision model is ready for employee facial scans."
            except VisionModelNotReadyError as exc:
                load_error = str(exc)
                message = str(exc)

        return {
            "ready": ready,
            "message": message,
            "architecture": self._architecture,
            "weights_path": str(self._weights_path),
            "weights_found": weights_found,
            "input_size": self._input_size,
            "max_frames_per_request": self._max_frames_per_request,
            "class_labels": list(self._class_labels),
            "load_error": load_error,
        }

    def predict_batch(self, frame_payloads: list[bytes], *, top_k: int = 3) -> dict[str, Any]:
        if not frame_payloads:
            raise InvalidVisionInputError("At least one image frame is required for prediction")
        if len(frame_payloads) > self._max_frames_per_request:
            raise InvalidVisionInputError(
                f"Received {len(frame_payloads)} frames, but the current limit is {self._max_frames_per_request}"
            )

        model = self._ensure_model_loaded()
        tensors: list[Tensor] = []
        for frame_payload in frame_payloads:
            try:
                tensors.append(preprocess_image_bytes(frame_payload, input_size=self._input_size))
            except InvalidImagePayloadError as exc:
                raise InvalidVisionInputError(str(exc)) from exc

        probabilities = self._predict_probabilities(model, tensors)
        averaged_probabilities = probabilities.mean(dim=0)
        top_k = max(1, min(top_k, len(self._class_labels)))

        return {
            "model_name": f"{self._architecture}:{self._weights_path.name}",
            "frame_count": len(frame_payloads),
            "dominant_label": self._label_for_index(int(averaged_probabilities.argmax().item())),
            "dominant_confidence": float(averaged_probabilities.max().item()),
            "averaged_scores": self._top_scores(averaged_probabilities, top_k=top_k),
            "frames": [
                {
                    "frame_index": frame_index,
                    "dominant_label": self._label_for_index(int(frame_probabilities.argmax().item())),
                    "dominant_confidence": float(frame_probabilities.max().item()),
                    "scores": self._top_scores(frame_probabilities, top_k=top_k),
                }
                for frame_index, frame_probabilities in enumerate(probabilities)
            ],
        }

    def _ensure_model_loaded(self) -> nn.Module:
        if self._model is not None:
            return self._model

        with self._load_lock:
            if self._model is not None:
                return self._model

            if not self._weights_path.exists():
                raise VisionModelNotReadyError(
                    f"Vision weights file was not found at '{self._weights_path}'. "
                    "Set VISION_MODEL_WEIGHTS_PATH to the correct .pth file."
                )

            try:
                model = build_classifier_model(
                    self._architecture,
                    len(self._class_labels),
                    classifier_hidden_dim=self._classifier_hidden_dim,
                )
            except ValueError as exc:
                raise VisionModelNotReadyError(str(exc)) from exc

            try:
                checkpoint = torch.load(self._weights_path, map_location=self._device)
            except Exception as exc:  # pragma: no cover - torch surface area varies by platform
                raise VisionModelNotReadyError(f"Failed to read vision checkpoint: {exc}") from exc

            try:
                state_dict_candidates = list(iter_state_dict_candidates(checkpoint))
            except ValueError as exc:
                raise VisionModelNotReadyError(str(exc)) from exc

            load_errors: list[str] = []
            for candidate_name, state_dict in state_dict_candidates:
                try:
                    model.load_state_dict(state_dict, strict=self._strict_model_load)
                    model.to(self._device)
                    model.eval()
                    self._model = model
                    return self._model
                except RuntimeError as exc:
                    load_errors.append(f"{candidate_name}: {exc}")

            mismatch_detail = load_errors[0] if load_errors else "unknown checkpoint incompatibility"
            raise VisionModelNotReadyError(
                "Failed to load vision model weights. "
                "Ensure VISION_MODEL_ARCHITECTURE and VISION_CLASS_LABELS match the training checkpoint. "
                f"First load error: {mismatch_detail}"
            )

    def _predict_probabilities(self, model: nn.Module, tensors: list[Tensor]) -> Tensor:
        batch = torch.stack(tensors).to(self._device)
        try:
            with torch.inference_mode():
                logits = model(batch)
        except Exception as exc:  # pragma: no cover - model runtime depends on user weights
            raise VisionInferenceError(f"Vision inference failed: {exc}") from exc

        if logits.ndim != 2 or logits.shape[1] != len(self._class_labels):
            raise VisionInferenceError(
                "Vision model returned an unexpected output shape. "
                f"Expected (*, {len(self._class_labels)}), received {tuple(logits.shape)}"
            )

        return torch.softmax(logits.detach().cpu(), dim=1)

    def _top_scores(self, probabilities: Tensor, *, top_k: int) -> list[dict[str, float | str]]:
        values, indices = torch.topk(probabilities, k=top_k)
        return [
            {
                "label": self._label_for_index(int(class_index.item())),
                "confidence": float(score.item()),
            }
            for score, class_index in zip(values, indices, strict=False)
        ]

    def _label_for_index(self, index: int) -> str:
        try:
            return self._class_labels[index]
        except IndexError as exc:
            raise VisionInferenceError(f"Received class index {index} outside configured label range") from exc

    def _resolve_weights_path(self, configured_path: str) -> Path:
        candidate_path = Path(configured_path).expanduser()
        if candidate_path.is_absolute():
            return candidate_path.resolve()
        return (PROJECT_ROOT_DIR / candidate_path).resolve()


@lru_cache
def get_vision_inference_service() -> VisionInferenceService:
    return VisionInferenceService()
