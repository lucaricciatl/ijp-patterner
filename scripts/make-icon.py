#!/usr/bin/env python3
"""App icon: a patterned tile — one solid band plus three staggered hairlines.

Writes build/icon.png (1024x1024, electron-builder turns it into .icns) and
build/icon.ico (multi-size, needed by the Windows target).

    python3 scripts/make-icon.py
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = Path(__file__).resolve().parent.parent / "build"
SIZE = 1024
SS = 3
W = SIZE * SS

INSET = 0.098
N = 5.0
ACCENT = (46, 230, 168)
LEADER = (233, 161, 59)
PANEL_TOP = (26, 41, 56)
PANEL_BOTTOM = (6, 10, 15)


def gradient(size: int) -> Image.Image:
    t = np.linspace(0.0, 1.0, size)[:, None]
    top = np.array(PANEL_TOP, dtype=float)
    bottom = np.array(PANEL_BOTTOM, dtype=float)
    rows = top[None, :] + (bottom - top)[None, :] * t
    return Image.fromarray(np.repeat(rows[:, None, :], size, axis=1).astype(np.uint8))


def squircle_mask(size: int) -> Image.Image:
    pad = INSET * size
    half = (size / 2) - pad
    c = size / 2.0
    y, x = np.mgrid[0:size, 0:size]
    nx = np.abs((x + 0.5 - c) / half)
    ny = np.abs((y + 0.5 - c) / half)
    d = (nx ** N + ny ** N) ** (1.0 / N)
    alpha = np.clip((1.0 - d) * half * 1.6, 0.0, 1.0)
    alpha = np.where(d <= 1.0, alpha, 0.0)
    return Image.fromarray((alpha * 255).astype(np.uint8))


def bar(draw: ImageDraw.ImageDraw, x0, y0, x1, y1, fill) -> None:
    draw.rounded_rectangle([x0, y0, x1, y1], radius=(y1 - y0) / 2, fill=fill)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    layer.paste(gradient(W).convert("RGBA"), (0, 0), squircle_mask(W))

    # ink is drawn on its own layer so it can be centred by measured bbox,
    # not by eye (the leader bar makes the drawing asymmetric)
    ink = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(ink)

    left, right = 0.20 * W, 0.80 * W
    top = 0.30 * W
    pitch = 0.115 * W
    thickness = 0.022 * W

    d.rounded_rectangle([left - 0.055 * W, top, left - 0.025 * W, top + 3 * pitch + thickness],
                        radius=0.015 * W, fill=LEADER + (255,))
    for i in range(4):
        y = top + i * pitch
        x0 = left + (0.0 if i % 2 == 0 else 0.10 * W)
        x1 = right - (0.10 * W if i % 2 == 0 else 0.0)
        if i == 0:
            d.rounded_rectangle([x0, y, x1, y + 0.075 * W], radius=0.035 * W, fill=ACCENT + (255,))
        else:
            bar(d, x0, y, x1, y + thickness, ACCENT + (255,))

    bbox = ink.getbbox()
    dx = round(W / 2 - (bbox[0] + bbox[2]) / 2)
    dy = round(W / 2 - (bbox[1] + bbox[3]) / 2)
    centred = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    centred.alpha_composite(ink, (dx, dy))

    glow = centred.filter(ImageFilter.GaussianBlur(18 * SS))
    glow.putalpha(glow.getchannel("A").point(lambda a: int(a * 0.45)))
    layer = Image.alpha_composite(layer, glow)
    layer = Image.alpha_composite(layer, centred)

    out = layer.resize((SIZE, SIZE), Image.LANCZOS)
    png = OUT_DIR / "icon.png"
    out.save(png)

    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    out.save(OUT_DIR / "icon.ico", sizes=ico_sizes)
    print(f"wrote {png} and build/icon.ico ({', '.join(f'{w}' for w, _ in ico_sizes)} px)")


if __name__ == "__main__":
    main()
