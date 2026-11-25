"""Render the app icon: render-icon.py <icon-mark.txt> <font.ttf> <out.png>

1024x1024, opaque. Amber glow behind the mark, the mark in accent colour with
four blurred glow layers, scanlines and a vignette, like the app's CRT look.
"""
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

SIZE = 1024
BG = (0x0C, 0x0A, 0x07)
ACCENT = (0xFF, 0xC4, 0x53)
# (blur radius in 1x px, rgb, alpha): the Glow layers from TalkativeCore.
GLOW = [(2, (255, 214, 130), 0.95), (7, (255, 170, 40), 0.80),
        (18, (255, 130, 10), 0.55), (42, (255, 110, 0), 0.35)]
SCALE = SIZE / 240  # glow radii and scanline size scale from the 1x design


def main(mark_path, font_path, out_path):
    lines = open(mark_path, encoding="utf-8").read().rstrip("\n").split("\n")
    cols = max(len(l) for l in lines)
    rows = len(lines)

    img = Image.new("RGB", (SIZE, SIZE), BG)

    # Radial amber glow, rgba(255,150,25,0.13) fading out by 62% of the radius.
    radius = SIZE / 2
    glow = Image.new("L", (SIZE, SIZE), 0)
    gp = glow.load()
    cx = cy = (SIZE - 1) / 2
    for y in range(SIZE):
        for x in range(SIZE):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / radius
            t = max(0.0, 1.0 - d / 0.62)
            gp[x, y] = int(255 * 0.13 * t)
    img = Image.composite(Image.new("RGB", (SIZE, SIZE), (255, 150, 25)), img, glow)

    # Size the mark to span 70% of the width (monospace: advance = 0.6 em).
    target_w = SIZE * 0.70
    font_size = target_w / (cols * 0.6)
    font = ImageFont.truetype(font_path, size=round(font_size * 4) / 4)
    adv = font.getlength("M")
    line_h = font_size  # line spacing 0 in the app: one em per row
    text_w = adv * cols
    text_h = line_h * rows
    x0 = (SIZE - text_w) / 2
    y0 = (SIZE - text_h) / 2

    def mark_layer():
        layer = Image.new("L", (SIZE, SIZE), 0)
        d = ImageDraw.Draw(layer)
        for r, line in enumerate(lines):
            for c, ch in enumerate(line):
                if ch != " ":
                    d.text((x0 + c * adv, y0 + r * line_h), ch, font=font, fill=255)
        return layer

    mask = mark_layer()
    for blur, rgb, alpha in reversed(GLOW):
        g = mask.filter(ImageFilter.GaussianBlur(blur * SCALE)).point(lambda v, a=alpha: int(v * a))
        img = Image.composite(Image.new("RGB", (SIZE, SIZE), rgb), img, g)
    img = Image.composite(Image.new("RGB", (SIZE, SIZE), ACCENT), img, mask)

    # Scanlines: 1 px at 24% black every 3 px, scaled x4.27.
    period = round(3 * 4.27)
    thick = round(1 * 4.27)
    scan = Image.new("L", (SIZE, SIZE), 0)
    sd = ImageDraw.Draw(scan)
    for y in range(0, SIZE, period):
        sd.rectangle([0, y, SIZE, y + thick - 1], fill=round(255 * 0.24))
    img = Image.composite(Image.new("RGB", (SIZE, SIZE), (0, 0, 0)), img, scan)

    # Vignette to 60% black at the corners.
    vig = Image.new("L", (SIZE, SIZE), 0)
    vp = vig.load()
    corner = (2 * cx * cx) ** 0.5
    for y in range(SIZE):
        for x in range(SIZE):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / corner
            vp[x, y] = int(255 * 0.60 * min(1.0, d * d))
    img = Image.composite(Image.new("RGB", (SIZE, SIZE), (0, 0, 0)), img, vig)

    img.convert("RGB").save(out_path, "PNG")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: render-icon.py <icon-mark.txt> <font.ttf> <out.png>")
    main(*sys.argv[1:])
