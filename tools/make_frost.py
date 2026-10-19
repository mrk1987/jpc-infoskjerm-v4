"""Lager rimmasken public/frost.webp fra et fotografi av rim på en rute.

Foto: Simon Fairhurst, Unsplash (Unsplash-lisensen):
https://unsplash.com/photos/frozen-patterns-on-a-light-blue-background-qwFlzoUQsC4

Bruk: python tools/make_frost.py <foto.jpg> public/frost.webp <forhåndsvisning.jpg>
Krever Pillow og numpy. Resultatet er en isblå RGBA-stripe på 1920 × 760 der
alfa er hvor tett rimet er; frost.js roterer den langs alle fire kanter.
"""
import sys
from PIL import Image, ImageFilter
import numpy as np

src, out, preview = sys.argv[1], sys.argv[2], sys.argv[3]
LENGTH = 1920  # stripa dekker en hel langside uten skjøt
DEPTH = 760

im = Image.open(src).convert("L")
w, h = im.size
# Hele bredden av fotoet skaleres til 1920 px, så én stripe dekker en
# langside. Bare den nederste delen brukes: der er bregnene tettest og vokser
# oppover, altså innover fra rammen.
scale = LENGTH / w
im = im.resize((LENGTH, round(h * scale)), Image.LANCZOS)
im = im.crop((0, im.height - DEPTH, LENGTH, im.height))

# Median og en lett uskarphet fjerner kamerakornet før kontrasten skrus opp.
im = im.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
a = np.asarray(im, dtype=np.float32) / 255.0
# Lokal kontrast: trekk fra en kraftig uskarphet, så de lyse isfjærene skiller
# seg ut fra det mattere glasset mellom dem uansett total lysstyrke.
blur = np.asarray(im.filter(ImageFilter.GaussianBlur(14)), dtype=np.float32) / 255.0
detail = a - blur
# Lysstyrke (tett rim) og detaljer (krystallkanter), så nivåer der glasset
# mellom fjærene blir klart og fjærene lyse.
base = (a - np.percentile(a, 5)) / (np.percentile(a, 99.7) - np.percentile(a, 5))
mask = 0.8 * base + 2.6 * detail
mask = np.clip((mask - 0.38) / 0.5, 0, 1) ** 1.25

rgba = np.zeros((DEPTH, LENGTH, 4), dtype=np.uint8)
rgba[..., 0], rgba[..., 1], rgba[..., 2] = 232, 242, 255  # isblå hvit
rgba[..., 3] = (mask * 255).astype(np.uint8)
Image.fromarray(rgba, "RGBA").save(out, "WEBP", quality=80, method=6)

# Forhåndsvisning mot skjermens mørkeblå bakgrunn.
bg = Image.new("RGBA", (LENGTH, DEPTH), (10, 18, 32, 255))
fg = Image.open(out).convert("RGBA")
Image.alpha_composite(bg, fg).convert("RGB").save(preview, quality=85)
print("mask mean", float(mask.mean()), "p90", float(np.percentile(mask, 90)))
