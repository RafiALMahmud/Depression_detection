from collections.abc import Callable, Iterator, Mapping
from typing import Any

import torch
from torch import Tensor, nn
from torchvision.models import mobilenet_v3_large, mobilenet_v3_small

from app.services.vision.efficientface import efficient_face

ArchitectureBuilder = Callable[[int, int | None], nn.Module]

STATE_DICT_CONTAINER_KEYS = ("state_dict", "model_state_dict", "model", "weights")
STATE_DICT_PREFIXES = ("module.", "_orig_mod.", "model.")

SUPPORTED_ARCHITECTURES: dict[str, ArchitectureBuilder] = {
    "efficientface": lambda num_classes, classifier_hidden_dim: _build_efficientface_model(
        num_classes,
        classifier_hidden_dim=classifier_hidden_dim,
    ),
    "mobilenet_v3_large": lambda num_classes, classifier_hidden_dim: _build_mobilenet_classifier_model(
        mobilenet_v3_large,
        "mobilenet_v3_large",
        num_classes,
        classifier_hidden_dim=classifier_hidden_dim,
    ),
    "mobilenet_v3_small": lambda num_classes, classifier_hidden_dim: _build_mobilenet_classifier_model(
        mobilenet_v3_small,
        "mobilenet_v3_small",
        num_classes,
        classifier_hidden_dim=classifier_hidden_dim,
    ),
}


def build_classifier_model(architecture: str, num_classes: int, *, classifier_hidden_dim: int | None = None) -> nn.Module:
    if num_classes < 1:
        raise ValueError("num_classes must be greater than zero")

    builder = SUPPORTED_ARCHITECTURES.get(architecture)
    if builder is None:
        supported = ", ".join(sorted(SUPPORTED_ARCHITECTURES))
        raise ValueError(f"Unsupported VISION_MODEL_ARCHITECTURE '{architecture}'. Supported values: {supported}")

    return builder(num_classes, classifier_hidden_dim)


def _build_mobilenet_classifier_model(
    builder: Callable[..., nn.Module],
    architecture: str,
    num_classes: int,
    *,
    classifier_hidden_dim: int | None,
) -> nn.Module:
    model = builder(weights=None)
    if not isinstance(model.classifier[0], nn.Linear) or not isinstance(model.classifier[-1], nn.Linear):
        raise ValueError(f"Unexpected classifier head for '{architecture}'")

    output_in_features = model.classifier[-1].in_features
    if classifier_hidden_dim is not None:
        if classifier_hidden_dim < 1:
            raise ValueError("classifier_hidden_dim must be greater than zero")
        in_features = model.classifier[0].in_features
        model.classifier[0] = nn.Linear(in_features, classifier_hidden_dim)
        output_in_features = classifier_hidden_dim

    model.classifier[-1] = nn.Linear(output_in_features, num_classes)
    return model


def _build_efficientface_model(num_classes: int, *, classifier_hidden_dim: int | None) -> nn.Module:
    if classifier_hidden_dim is not None:
        raise ValueError(
            "VISION_CLASSIFIER_HIDDEN_DIM is only supported for MobileNetV3 architectures. "
            "Leave it blank when VISION_MODEL_ARCHITECTURE=efficientface."
        )

    return efficient_face(num_classes=num_classes)


def iter_state_dict_candidates(checkpoint: Any) -> Iterator[tuple[str, dict[str, Tensor]]]:
    base_state_dict = _extract_state_dict(checkpoint)
    yield ("raw", base_state_dict)

    for prefix in STATE_DICT_PREFIXES:
        if any(key.startswith(prefix) for key in base_state_dict):
            yield (f"strip:{prefix}", _strip_prefix(base_state_dict, prefix))


def _extract_state_dict(checkpoint: Any) -> dict[str, Tensor]:
    if _is_tensor_mapping(checkpoint):
        return dict(checkpoint)

    if isinstance(checkpoint, Mapping):
        for key in STATE_DICT_CONTAINER_KEYS:
            candidate = checkpoint.get(key)
            if _is_tensor_mapping(candidate):
                return dict(candidate)

    raise ValueError("Checkpoint does not contain a supported PyTorch state_dict payload")


def _is_tensor_mapping(value: Any) -> bool:
    if not isinstance(value, Mapping) or not value:
        return False
    return all(isinstance(key, str) and isinstance(tensor, Tensor) for key, tensor in value.items())


def _strip_prefix(state_dict: Mapping[str, Tensor], prefix: str) -> dict[str, Tensor]:
    return {
        (key[len(prefix) :] if key.startswith(prefix) else key): tensor
        for key, tensor in state_dict.items()
    }
