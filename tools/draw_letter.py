"""Draws entry.png: "How was your day? (circle one)", a letter to the judge from Noor, age 6.

Everybody shows the judge a picture; nobody asks how its day was. Noor asks, gives three crayon faces to
circle, and, since the judge has no hands, circles one for it.

Run offline (the grader only copies the result): python tools/draw_letter.py
Needs Pillow and the Ink Free font that ships with Windows (C:/Windows/Fonts/Inkfree.ttf).
Everything else (paper, tape, desk, crayon faces, the red crayon) is drawn here.
"""

import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "entry.png"
FONT = "C:/Windows/Fonts/Inkfree.ttf"
S = 2  # draw at 2x, then downsample to 1024 for clean edges
SIZE = 1024 * S
rng = random.Random(20261114)


def font(px):
    return ImageFont.truetype(FONT, int(px * S))


def grain(w, h, sigma=40, blur=0.8):
    """Paper/crayon tooth: gaussian noise, a touch blurred, as an L image centred on 128."""
    n = Image.effect_noise((w, h), sigma)
    return n.filter(ImageFilter.GaussianBlur(blur * S))


# ---------- crayon ----------
def crayon_path(layer, pts, color, width, passes=4, jitter=1.6, alpha=210):
    """A waxy crayon stroke: a few slightly offset passes of the same path, each a little translucent."""
    d = ImageDraw.Draw(layer, "RGBA")
    for _ in range(passes):
        ox = rng.uniform(-jitter, jitter) * S
        oy = rng.uniform(-jitter, jitter) * S
        q = [(x * S + ox + rng.uniform(-0.6, 0.6) * S, y * S + oy + rng.uniform(-0.6, 0.6) * S) for x, y in pts]
        d.line(q, fill=color + (alpha,), width=int(width * S), joint="curve")
        for x, y in (q[0], q[-1]):
            r = width * S / 2
            d.ellipse([x - r, y - r, x + r, y + r], fill=color + (alpha,))


def crayon_fill_circle(layer, cx, cy, r, color, alpha=150):
    """Scribble-fill a circle the way a six-year-old does: back-and-forth strokes, slightly over the line."""
    d = ImageDraw.Draw(layer, "RGBA")
    y = cy - r
    step = 5
    while y < cy + r:
        half = math.sqrt(max(r * r - (y - cy) ** 2, 0)) * rng.uniform(0.9, 1.04)
        x0, x1 = cx - half, cx + half
        d.line([(x0 * S, y * S), (x1 * S, (y + rng.uniform(1, 4)) * S)], fill=color + (alpha,), width=int(6 * S))
        y += step * rng.uniform(0.8, 1.2)


def circle_pts(cx, cy, rx, ry, a0=0.0, a1=2 * math.pi, n=64, wobble=0.0):
    out = []
    for i in range(n + 1):
        t = a0 + (a1 - a0) * i / n
        w = 1 + wobble * math.sin(3 * t + 0.7) + wobble * 0.5 * math.sin(7 * t)
        out.append((cx + rx * w * math.cos(t), cy + ry * w * math.sin(t)))
    return out


def textured(layer, strength=0.75):
    """Knock holes in a crayon layer's alpha with paper tooth, so it reads as wax on paper."""
    r, g, b, a = layer.split()
    tooth = grain(layer.width, layer.height, sigma=70, blur=0.6)
    tooth = tooth.point(lambda v: 255 if v > 108 else int(255 * (1 - strength)))
    a = ImageChops.multiply(a, tooth)
    return Image.merge("RGBA", (r, g, b, a))


# ---------- the three faces ----------
INK = (52, 58, 104)
RED = (214, 46, 52)


def face(layer, cx, cy, r, kind):
    if kind == "good":
        crayon_fill_circle(layer, cx, cy, r, (255, 206, 40), 170)
        crayon_path(layer, circle_pts(cx, cy, r, r, wobble=0.02), (232, 140, 30), 5)
        # rays: it is a sun-face, the happiest thing a kid can draw
        for i in range(10):
            a = i * 2 * math.pi / 10 + 0.2
            crayon_path(layer, [(cx + math.cos(a) * (r + 12), cy + math.sin(a) * (r + 12)),
                                (cx + math.cos(a) * (r + 32), cy + math.sin(a) * (r + 32))], (240, 160, 30), 5, passes=3)
        # happy closed eyes and a huge smile
        for ex in (-24, 24):
            crayon_path(layer, circle_pts(cx + ex, cy - 10, 11, 9, math.pi, 2 * math.pi, 12), INK, 4.5, passes=3)
        crayon_path(layer, circle_pts(cx, cy + 6, 36, 30, 0.15, math.pi - 0.15, 20), INK, 5, passes=3)
        for ex in (-44, 44):
            crayon_fill_circle(layer, cx + ex, cy + 16, 10, (255, 120, 140), 150)
    elif kind == "okay":
        crayon_fill_circle(layer, cx, cy, r, (150, 205, 245), 140)
        crayon_path(layer, circle_pts(cx, cy, r, r, wobble=0.025), (80, 140, 200), 5)
        for ex in (-22, 22):
            crayon_fill_circle(layer, cx + ex, cy - 10, 6, INK, 230)
        crayon_path(layer, [(cx - 22, cy + 26), (cx + 22, cy + 24)], INK, 5, passes=3)
    else:  # long
        crayon_fill_circle(layer, cx, cy, r, (200, 180, 235), 140)
        crayon_path(layer, circle_pts(cx, cy, r, r, wobble=0.03), (130, 105, 190), 5)
        for ex in (-22, 22):  # droopy tired eyes
            crayon_path(layer, [(cx + ex - 12, cy - 8), (cx + ex + 12, cy - 4)], INK, 4.5, passes=3)
        crayon_path(layer, circle_pts(cx, cy + 34, 18, 10, math.pi + 0.3, 2 * math.pi - 0.3, 12), INK, 5, passes=3)
        crayon_path(layer, [(cx + r - 4, cy - r + 6), (cx + r + 6, cy - r + 22)], (90, 150, 230), 5, passes=2)  # a sweat drop


# ---------- the paper ----------
PW, PH = 900, 930


def paper():
    p = Image.new("RGBA", (PW * S, PH * S), (253, 250, 241, 255))
    tooth = grain(PW * S, PH * S, sigma=10, blur=1.2).convert("RGBA")
    p = Image.blend(p, ImageChops.multiply(p, tooth.point(lambda v: min(255, v + 120))), 0.35)
    d = ImageDraw.Draw(p, "RGBA")
    for y in range(100, PH - 20, 52):
        d.line([(0, y * S), (PW * S, y * S)], fill=(140, 180, 225, 150), width=int(2 * S))
    d.line([(84 * S, 0), (84 * S, PH * S)], fill=(232, 130, 140, 170), width=int(2.5 * S))

    t = ImageDraw.Draw(p, "RGBA")

    def say(x, line, text, size=44, color=INK):
        y = 100 + 52 * line - 9
        t.text((x * S, y * S), text, font=font(size), fill=color + (235,), anchor="ls", stroke_width=1, stroke_fill=color + (200,))

    say(104, 0, "dear judge,", 56)
    say(104, 1, "everybody shows you their picture.")
    say(104, 2, "nobody ever asks how your day was.")
    say(104, 3, "so i am asking. how was your day?")
    say(104, 4, "(circle one)", 38, (90, 96, 140))

    crayon = Image.new("RGBA", p.size, (0, 0, 0, 0))
    faces = [(230, 440, "good"), (460, 440, "okay"), (690, 440, "long")]
    for cx, cy, kind in faces:
        face(crayon, cx, cy, 62, kind)
    # Noor's red circle around "good": twice round, the way you circle the answer you are sure of
    loop = circle_pts(232, 470, 128, 136, -2.2, -2.2 + 2 * math.pi * 1.18, 90, wobble=0.035)
    crayon_path(crayon, loop, RED, 7, passes=3, alpha=225)
    # hearts by the signature
    for hx, hy, hs in ((694, 611, 15), (734, 596, 10)):
        heart = [(hx + hs * 16 * math.sin(a) ** 3 / 16, hy - hs * (13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)) / 16)
                 for a in [i * 2 * math.pi / 40 for i in range(41)]]
        crayon_path(crayon, heart, RED, 4, passes=3)
    # Noor's blanket, offered in the p.p.s.: a little folded checked blanket with a heart patch
    bx0, by0, bx1, by1 = 372, 846, 520, 902
    for yy in range(by0 + 4, by1 - 2, 6):
        crayon_path(crayon, [(bx0 + 4, yy), (bx1 - 4, yy + rng.uniform(-1, 1))], (255, 170, 190), 5, passes=1, jitter=0.8, alpha=150)
    for xx in range(bx0 + 22, bx1, 26):
        crayon_path(crayon, [(xx, by0 + 2), (xx + 2, by1 - 2)], (120, 170, 230), 3.5, passes=2)
    for yy in (by0 + 20, by0 + 40):
        crayon_path(crayon, [(bx0 + 2, yy), (bx1 - 2, yy + 1)], (120, 170, 230), 3.5, passes=2)
    crayon_path(crayon, [(bx0, by0), (bx1, by0 + 2), (bx1 - 2, by1), (bx0 + 2, by1 - 1), (bx0, by0)], (220, 90, 120), 4.5, passes=3)
    for yy in range(by0 + 6, by1, 10):  # fringe
        crayon_path(crayon, [(bx1 + 2, yy), (bx1 + 14, yy + 2)], (220, 90, 120), 3, passes=2)
    hx, hy, hs = 446, 874, 13
    heart = [(hx + hs * math.sin(a) ** 3, hy - hs * (13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)) / 16)
             for a in [i * 2 * math.pi / 40 for i in range(41)]]
    crayon_path(crayon, heart, RED, 4, passes=3)
    crayon = textured(crayon)
    p.alpha_composite(crayon)

    t = ImageDraw.Draw(p, "RGBA")
    for cx, label in ((230, "good"), (460, "okay"), (690, "long")):
        t.text((cx * S, (100 + 52 * 9 - 9) * S), label, font=font(42), fill=INK + (235,), anchor="ms", stroke_width=1, stroke_fill=INK + (200,))
    say(410, 10, "love, noor (6)", 46)
    say(104, 11, "p.s. you don't have hands, so i circled", 40)
    say(104, 12, "one for you. i picked good.", 40)
    say(104, 13, "i hope that's ok.", 40)
    say(104, 14, "p.p.s. if it was long, you can borrow", 40)
    say(104, 15, "my blanket.", 40)
    return p


# ---------- the desk, the tape, the crayon ----------
def desk():
    base = Image.new("RGB", (SIZE, SIZE), (196, 140, 92))
    d = ImageDraw.Draw(base)
    for y in range(0, SIZE, 2):
        v = math.sin(y / (37 * S)) * 6 + math.sin(y / (11 * S) + 1.3) * 4 + math.sin(y / (97 * S)) * 9
        c = (int(190 + v), int(134 + v * 0.8), int(88 + v * 0.6))
        d.line([(0, y), (SIZE, y)], fill=c, width=2)
    tooth = grain(SIZE, SIZE, sigma=14, blur=2.5).convert("RGB")
    return Image.blend(base, ImageChops.multiply(base, tooth.point(lambda v: min(255, v + 110))), 0.5)


def tape(w, h, angle):
    t = Image.new("RGBA", (int(w * S), int(h * S)), (238, 226, 190, 175))
    tooth = grain(t.width, t.height, sigma=18, blur=0.6)
    r, g, b, a = t.split()
    a = ImageChops.multiply(a, tooth.point(lambda v: min(255, v + 140)))
    t = Image.merge("RGBA", (r, g, b, a))
    return t.rotate(angle, expand=True, resample=Image.BICUBIC)


def red_crayon():
    c = Image.new("RGBA", (int(250 * S), int(40 * S)), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    d.rounded_rectangle([0, 6 * S, 200 * S, 34 * S], radius=6 * S, fill=(205, 40, 46, 255))
    d.rectangle([40 * S, 6 * S, 170 * S, 34 * S], fill=(232, 70, 70, 255))  # paper wrapper
    d.line([(40 * S, 12 * S), (170 * S, 12 * S)], fill=(255, 150, 150, 255), width=int(3 * S))
    d.polygon([(200 * S, 6 * S), (240 * S, 17 * S), (240 * S, 23 * S), (200 * S, 34 * S)], fill=(190, 34, 40, 255))
    return c.rotate(28, expand=True, resample=Image.BICUBIC)


def shadow_of(img, blur, alpha):
    a = img.split()[3].point(lambda v: v * alpha // 255)
    sh = Image.new("RGBA", img.size, (60, 30, 10, 0))
    sh.putalpha(a)
    return sh.filter(ImageFilter.GaussianBlur(blur * S))


def main():
    canvas = desk().convert("RGBA")
    sheet = paper().rotate(-1.4, expand=True, resample=Image.BICUBIC)
    sx = (SIZE - sheet.width) // 2
    sy = (SIZE - sheet.height) // 2 - 6 * S
    canvas.alpha_composite(shadow_of(sheet, 10, 120), (sx + 8 * S, sy + 12 * S))
    canvas.alpha_composite(sheet, (sx, sy))
    for x, y, ang in ((70, 20, 38), (840, 26, -34)):
        canvas.alpha_composite(tape(150, 46, ang), (int(x * S), int(y * S)))
    cr = red_crayon()
    canvas.alpha_composite(shadow_of(cr, 4, 110), (int(800 * S), int(872 * S)))
    canvas.alpha_composite(cr, (int(792 * S), int(862 * S)))

    # warm afternoon light from the top left, and a soft vignette
    light = Image.radial_gradient("L").resize((SIZE * 2, SIZE * 2)).crop((SIZE // 2, SIZE // 2, SIZE // 2 + SIZE, SIZE // 2 + SIZE))
    # a smooth pool of light centred near the top-left corner (no hard edge anywhere)
    o = SIZE - 180 * S
    corner = Image.radial_gradient("L").resize((SIZE * 2, SIZE * 2), Image.BICUBIC).crop((o, o, o + SIZE, o + SIZE))
    warm = Image.new("RGBA", (SIZE, SIZE), (255, 214, 150, 0))
    warm.putalpha(corner.point(lambda v: int(max(0, 210 - v) * 0.5)).filter(ImageFilter.GaussianBlur(8 * S)))
    canvas.alpha_composite(warm)
    vig = Image.new("RGBA", (SIZE, SIZE), (40, 20, 5, 0))
    vig.putalpha(light.point(lambda v: int(max(0, v - 150) * 0.6)))
    canvas.alpha_composite(vig)

    out = canvas.convert("RGB").resize((1024, 1024), Image.LANCZOS)
    out.save(OUT, "PNG", optimize=True)
    if OUT.stat().st_size > 1024 * 1024:  # the gate takes at most 1 MiB; a JPEG keeps the name entry.png
        out.save(OUT, "JPEG", quality=93, optimize=True, subsampling=0)
    print(OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
