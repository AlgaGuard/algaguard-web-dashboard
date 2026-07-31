"""Create reproducible web assets from the approved AlgaGuard logo."""

from pathlib import Path
from shutil import copyfile

from PIL import Image


SOURCE = Path(r"D:\algaguard-project\brand\algaguard-logo.png")
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "brand"


def padded_icon(source: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    image = source.copy().convert("RGBA")
    image.thumbnail((round(size * 0.82), round(size * 0.82)), Image.Resampling.LANCZOS)
    offset = ((size - image.width) // 2, (size - image.height) // 2)
    canvas.alpha_composite(image, offset)
    return canvas


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Approved logo is missing: {SOURCE}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    copyfile(SOURCE, OUTPUT / "algaguard-logo.png")
    with Image.open(SOURCE) as source:
        for size in (32, 192, 512):
            padded_icon(source, size).save(
                OUTPUT / f"algaguard-{size}.png", optimize=True
            )


if __name__ == "__main__":
    main()
