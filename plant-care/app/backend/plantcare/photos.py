import os
import warnings
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_IMAGE_DIMENSION = 2048
ALLOWED_FORMATS = {"HEIF", "JPEG", "PNG", "WEBP"}

register_heif_opener(thumbnails=False)


class InvalidPhotoError(ValueError):
    pass


def prepare_photo(data: bytes) -> bytes:
    if not data:
        raise InvalidPhotoError("The selected photo is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise InvalidPhotoError("Photos must be 10 MB or smaller.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
            with Image.open(BytesIO(data)) as source:
                if source.format not in ALLOWED_FORMATS:
                    raise InvalidPhotoError("Use a JPEG, PNG, WebP, HEIC, or HEIF photo.")
                source.load()
                image = ImageOps.exif_transpose(source)
                image.thumbnail(
                    (MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION),
                    Image.Resampling.LANCZOS,
                )
                if image.mode in {"RGBA", "LA"}:
                    background = Image.new("RGB", image.size, "white")
                    alpha = image.getchannel("A")
                    background.paste(image.convert("RGB"), mask=alpha)
                    image = background
                elif image.mode != "RGB":
                    image = image.convert("RGB")
                output = BytesIO()
                image.save(output, format="JPEG", quality=86, optimize=True)
                return output.getvalue()
    except InvalidPhotoError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise InvalidPhotoError("The photo dimensions are too large.") from None
    except (OSError, UnidentifiedImageError):
        raise InvalidPhotoError("The selected file is not a valid photo.") from None


def photo_path(data_dir: Path, plant_id: str) -> Path:
    return data_dir / "photos" / f"{plant_id}.jpg"


def store_photo(path: Path, data: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as target:
            target.write(data)
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)
