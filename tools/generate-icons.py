#!/usr/bin/env python3
"""Generate Marvin's PWA icons from the official BCR app artwork.

Source: tools/bcr-app-icon.png
Usage: python3 tools/generate-icons.py
Requires Pillow.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tools" / "bcr-app-icon.png"
OUT = ROOT / "public" / "assets" / "icons"

BLUE = (6, 58, 117)
WHITE = (255, 255, 255, 255)
CROP = (8, 8, 504, 504)
CORNER_RATIO = 0.151


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=radius, fill=255
    )
    return mask


def load_logo():
    source = Image.open(SOURCE).convert("RGBA").crop(CROP)
    size = source.size[0]
    mask = rounded_mask(size, int(size * CORNER_RATIO))
    logo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    logo.paste(source, (0, 0), mask)
    return logo


def save_resized(logo, size, filename, background=None):
    image = logo.resize((size, size), Image.LANCZOS)
    if background is None:
        image.save(OUT / filename, optimize=True)
    else:
        canvas = Image.new("RGBA", (size, size), background)
        canvas.alpha_composite(image)
        canvas.convert("RGB").save(OUT / filename, optimize=True)
    print(f"wrote {OUT / filename}")


def build_maskable(logo, size, filename):
    canvas = Image.new("RGBA", (size, size), (*BLUE, 255))
    logo_size = round(size * 0.8)
    artwork = logo.resize((logo_size, logo_size), Image.LANCZOS)
    offset = (size - logo_size) // 2
    canvas.alpha_composite(artwork, (offset, offset))
    canvas.convert("RGB").save(OUT / filename, optimize=True)
    print(f"wrote {OUT / filename}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    logo = load_logo()

    save_resized(logo, 192, "icon-192.png")
    save_resized(logo, 512, "icon-512.png")
    build_maskable(logo, 512, "icon-maskable-512.png")
    save_resized(logo, 180, "apple-touch-icon.png", background=WHITE)
    save_resized(logo, 32, "favicon-32.png", background=WHITE)


if __name__ == "__main__":
    main()
