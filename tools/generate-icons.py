#!/usr/bin/env python3
"""Generate Marvin's PWA icons.

Usage: python3 tools/generate-icons.py
Requires Pillow and DejaVu Sans Bold.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "icons"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

TOP = (12, 80, 156)
BOTTOM = (3, 39, 82)
GOLD = (255, 205, 0)
WHITE = (255, 255, 255, 255)
SS = 4  # supersampling


def gradient(size):
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / max(1, size - 1)
        color = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (size, y)], fill=(*color, 255))
    return image


def gold_glow(size):
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    draw.ellipse(
        [size * 0.52, -size * 0.34, size * 1.22, size * 0.36],
        fill=(*GOLD, 110),
    )
    return glow.filter(ImageFilter.GaussianBlur(size * 0.07))


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=radius, fill=255
    )
    return mask


def build(size, *, radius_ratio, glyph_ratio, full_bleed, filename):
    canvas = size * SS
    base = gradient(canvas)
    base.alpha_composite(gold_glow(canvas))

    if full_bleed:
        image = base
    else:
        image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        image.paste(base, (0, 0), rounded_mask(canvas, int(canvas * radius_ratio)))

    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(FONT, int(canvas * glyph_ratio))
    text = "BCR"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (canvas - text_width) / 2 - bbox[0]
    y = (canvas - text_height) / 2 - bbox[1] - canvas * 0.015
    draw.text((x, y), text, font=font, fill=WHITE)

    # Small gold underline, like a ledger rule.
    line_width = canvas * 0.28
    line_height = max(2, int(canvas * 0.018))
    line_x = (canvas - line_width) / 2
    glyph_bottom = y + bbox[1] + text_height
    line_y = glyph_bottom + canvas * 0.045
    draw.rounded_rectangle(
        [line_x, line_y, line_x + line_width, line_y + line_height],
        radius=line_height / 2,
        fill=(*GOLD, 255),
    )

    final = image.resize((size, size), Image.LANCZOS)
    final.save(OUT / filename, optimize=True)
    print(f"wrote {OUT / filename}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    build(192, radius_ratio=0.23, glyph_ratio=0.25, full_bleed=False, filename="icon-192.png")
    build(512, radius_ratio=0.23, glyph_ratio=0.25, full_bleed=False, filename="icon-512.png")
    build(
        512,
        radius_ratio=0.23,
        glyph_ratio=0.21,
        full_bleed=True,
        filename="icon-maskable-512.png",
    )
    build(180, radius_ratio=0.0, glyph_ratio=0.23, full_bleed=True, filename="apple-touch-icon.png")

    favicon = Image.open(OUT / "icon-192.png").resize((32, 32), Image.LANCZOS)
    favicon.save(OUT / "favicon-32.png", optimize=True)
    print(f"wrote {OUT / 'favicon-32.png'}")


if __name__ == "__main__":
    main()
