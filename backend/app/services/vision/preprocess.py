from io import BytesIO

import torch
import torchvision.transforms.functional as TF
from PIL import Image, ImageOps, UnidentifiedImageError

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


class InvalidImagePayloadError(ValueError):
    pass


def preprocess_image_bytes(image_bytes: bytes, *, input_size: int) -> torch.Tensor:
    image = _load_image(image_bytes)
    fitted = ImageOps.fit(image, (input_size, input_size), method=Image.Resampling.BILINEAR)
    tensor = TF.to_tensor(fitted)
    return TF.normalize(tensor, IMAGENET_MEAN, IMAGENET_STD)


def _load_image(image_bytes: bytes) -> Image.Image:
    if not image_bytes:
        raise InvalidImagePayloadError("Uploaded frame was empty")

    try:
        image = Image.open(BytesIO(image_bytes))
        image.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidImagePayloadError("Uploaded frame is not a readable image") from exc

    return ImageOps.exif_transpose(image).convert("RGB")
