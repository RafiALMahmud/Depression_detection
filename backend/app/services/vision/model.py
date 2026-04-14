from collections.abc import Iterator, Mapping
from typing import Any

import torch
from torch import Tensor, nn
from torchvision.models import mobilenet_v3_large, mobilenet_v3_small

SUPPORTED_ARCHITECTURES = {
    "mobilenet_v3_small": mobilenet_v3_small,
    "mobilenet_v3_large": mobilenet_v3_large,
}

STATE_DICT_CONTAINER_KEYS = ("state_dict", "model_state_dict", "model", "weights")
STATE_DICT_PREFIXES = ("module.", "_orig_mod.", "model.")


def build_classifier_model(architecture: str, num_classes: int) -> nn.Module:
    if num_classes < 1:
        raise ValueError("num_classes must be greater than zero")

    builder = SUPPORTED_ARCHITECTURES.get(architecture)
    if builder is None:
        supported = ", ".join(sorted(SUPPORTED_ARCHITECTURES))
        raise ValueError(f"Unsupported VISION_MODEL_ARCHITECTURE '{architecture}'. Supported values: {supported}")

    model = builder(weights=None)
    if not isinstance(model.classifier[-1], nn.Linear):
        raise ValueError(f"Unexpected classifier head for '{architecture}'")

    in_features = model.classifier[-1].in_features
    model.classifier[-1] = nn.Linear(in_features, num_classes)
    return model


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
