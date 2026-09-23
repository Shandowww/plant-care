from io import BytesIO

import pytest
from PIL import Image
from plantcare.photos import InvalidPhotoError, prepare_photo, prepare_photo_for_analysis


@pytest.mark.parametrize("image_format", ["MPO", "AVIF", "HEIF", "JPEG"])
@pytest.mark.parametrize("normalize", [prepare_photo, prepare_photo_for_analysis])
def test_gallery_formats_normalize_primary_still_without_metadata(image_format, normalize):
    source = BytesIO()
    original = Image.new("RGB", (64, 32), "green")
    exif = Image.Exif()
    exif[270] = "Private description"
    options = {"exif": exif}
    if image_format == "MPO":
        options.update(save_all=True, append_images=[Image.new("RGB", (64, 32), "red")])
    original.save(source, format=image_format, **options)
    with Image.open(BytesIO(source.getvalue())) as decoded:
        assert decoded.format == image_format
    with Image.open(BytesIO(normalize(source.getvalue()))) as result:
        assert result.format == "JPEG"
        assert result.size == (64, 32)
        assert not result.getexif()
        red, green, blue = result.getpixel((10, 10))
        assert green > red and green > blue


def test_unsupported_decodable_format_still_rejected():
    source = BytesIO()
    Image.new("RGB", (32, 32)).save(source, format="BMP")
    with pytest.raises(InvalidPhotoError, match="Use a JPEG"):
        prepare_photo_for_analysis(source.getvalue())
