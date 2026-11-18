"""
Builds every OnlyTanker logo, icon and splash image from the master artwork brand/onlytanker-logo.png
(orange location pin with a tanker, plus the "OnlyTanker" wordmark, on a light grey background).

    python brand/build-brand-assets.py

The grey background is removed (flood fill from the edges, so the white tanker inside the pin stays
opaque), then the pin and the wordmark are cut apart and written as:

  mobile/src/assets/images/
    logo-mark.png        pin only, transparent, tight square (in-app logo, auth headings)
    wordmark.png         "OnlyTanker" in navy, transparent
    wordmark-light.png   "OnlyTanker" in white, transparent (dark headers, welcome screen)
    icon.png             1024 opaque app icon: pin on white
    adaptive-icon.png    1024 Android adaptive foreground: pin inside the safe zone (background colour in app.json)
    splash-icon.png      1024 transparent: pin small enough for Android 12's circular splash mask
  web/public/brand/ and admin-web/public/brand/: logo-mark.png, wordmark.png, wordmark-light.png, logo-full.png
  web/src/app/ and admin-web/src/app/: icon.png (favicon) and apple-icon.png
"""
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "brand" / "onlytanker-logo.png"
NEAR_BG = 40  # max channel difference that still counts as background for the flood fill


def remove_background(im: Image.Image) -> Image.Image:
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    bg = px[0, 0]
    dist = lambda c: max(abs(c[0] - bg[0]), abs(c[1] - bg[1]), abs(c[2] - bg[2]))

    outside = bytearray(w * h)
    q = deque((x, y) for x in range(w) for y in (0, h - 1))
    q.extend((x, y) for y in range(h) for x in (0, w - 1))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if outside[i] or dist(px[x, y]) >= NEAR_BG:
            continue
        outside[i] = 1
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))

    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if not outside[y * w + x]:
                # Inside a shape. Edge pixels (still a blend with the grey) get partial alpha too.
                d = dist(c)
                a = 1.0 if d >= NEAR_BG or not touches_outside(outside, x, y, w, h) else max(d / NEAR_BG, 0.0)
            else:
                a = 0.0  # background side of the edge: drop it, so no grey fringe on dark backgrounds
            if a <= 0.02:
                op[x, y] = (0, 0, 0, 0)
                continue
            # Un-mix the grey background so edges keep their true colour.
            col = tuple(max(0, min(255, round((c[k] - bg[k] * (1 - a)) / a))) for k in range(3))
            op[x, y] = (*col, round(a * 255))
    return out


def touches_outside(outside, x, y, w, h):
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h and outside[ny * w + nx]:
            return True
    return False


TEXT_NAVY = (2, 19, 49)


def wordmark_from_source(src: Image.Image, x0: int) -> Image.Image:
    """The wordmark is one flat navy colour, so alpha comes straight from darkness (keeps the holes in O, a, e)."""
    grey = src.convert("L").crop((x0, 0, src.width, src.height))
    bg, ink = grey.getpixel((grey.width - 1, 0)), 30
    alpha = grey.point(lambda v: 0 if (bg - v) / (bg - ink) < 0.06 else min(255, round(255 * (bg - v) / (bg - ink))))
    word = Image.new("RGBA", grey.size, (*TEXT_NAVY, 255))
    word.putalpha(alpha)
    return word.crop(alpha.getbbox())


def split(im: Image.Image):
    """Pin = first run of non-empty columns; wordmark = everything after the first gap."""
    w, h = im.size
    alpha = im.getchannel("A").load()
    filled = [any(alpha[x, y] > 20 for y in range(h)) for x in range(w)]
    start = filled.index(True)
    end = start
    while end < w and filled[end]:
        end += 1
    pin = im.crop((0, 0, end, h))
    word = im.crop((end, 0, w, h))
    return pin.crop(pin.getbbox()), end


def on_canvas(img: Image.Image, size: int, fill: float, bg=(0, 0, 0, 0)) -> Image.Image:
    """Centre `img` on a square canvas, scaled so its longer side is `fill` of the canvas."""
    canvas = Image.new("RGBA", (size, size), bg)
    scale = size * fill / max(img.size)
    fitted = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return canvas


def recolour(img: Image.Image, rgb) -> Image.Image:
    solid = Image.new("RGBA", img.size, (*rgb, 255))
    solid.putalpha(img.getchannel("A"))
    return solid


def save(img: Image.Image, *paths: Path):
    for p in paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        img.save(p, optimize=True)
        print("wrote", p.relative_to(ROOT), img.size)


def main():
    src = Image.open(SRC)
    cut = remove_background(src)
    pin, pin_end = split(cut)
    word = wordmark_from_source(src, pin_end)
    # Full lockup: pin + wordmark side by side, as in the master artwork.
    gap, h = round(pin.height * 0.12), pin.height
    wh = round(h * 0.62)
    word_sized = word.resize((round(word.width * wh / word.height), wh), Image.LANCZOS)
    full_padded = Image.new("RGBA", (pin.width + gap + word_sized.width, h))
    full_padded.alpha_composite(pin, (0, 0))
    full_padded.alpha_composite(word_sized, (pin.width + gap, round(h * 0.2)))

    mark = on_canvas(pin, 512, 0.96)
    word_dark = word
    word_light = recolour(word, (255, 255, 255))

    mobile = ROOT / "mobile" / "src" / "assets" / "images"
    save(mark, mobile / "logo-mark.png")
    save(word_dark, mobile / "wordmark.png")
    save(word_light, mobile / "wordmark-light.png")
    save(on_canvas(pin, 1024, 0.74, (255, 255, 255, 255)).convert("RGB"), mobile / "icon.png")
    save(on_canvas(pin, 1024, 0.56), mobile / "adaptive-icon.png")
    save(on_canvas(pin, 1024, 0.5), mobile / "splash-icon.png")

    for site in ("web", "admin-web"):
        pub = ROOT / site / "public" / "brand"
        save(mark, pub / "logo-mark.png")
        save(word_dark, pub / "wordmark.png")
        save(word_light, pub / "wordmark-light.png")
        save(full_padded, pub / "logo-full.png")
        app = ROOT / site / "src" / "app"
        save(on_canvas(pin, 256, 0.94), app / "icon.png")
        save(on_canvas(pin, 180, 0.78, (255, 255, 255, 255)).convert("RGB"), app / "apple-icon.png")


if __name__ == "__main__":
    main()
