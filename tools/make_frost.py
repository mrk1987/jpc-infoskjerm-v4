"""Lager rimrammen public/frost.webp fra et bilde av rim mot svart bakgrunn.

Kildebildet er en ferdig ramme av rimbregner langs kantene på svart, i
formatet 9:16 (samme som skjermen). Lysstyrken blir dekkevne: svart blir
klart glass og de lyse krystallene blir is.

Bruk: python tools/make_frost.py <kilde.png> public/frost.webp <forhåndsvisning.jpg>
Krever Pillow og numpy.
"""
import sys
from PIL import Image
import numpy as np

src, out, preview = sys.argv[1], sys.argv[2], sys.argv[3]
W, H = 1080, 1920

im = Image.open(src).convert("L")
if abs(im.width / im.height - W / H) > 0.01:
    sys.exit(f"Kildebildet må være 9:16, er {im.width}x{im.height}")
im = im.resize((W, H), Image.LANCZOS)

lum = np.asarray(im, dtype=np.float32) / 255.0
# Svart under 4 % blir helt klart, så støy i bakgrunnen ikke gir et grått
# slør; de lyseste krystallene blir fullt dekkende.
alpha = np.clip((lum - 0.04) / 0.82, 0, 1) ** 0.9

rgba = np.zeros((H, W, 4), dtype=np.uint8)
rgba[..., 0], rgba[..., 1], rgba[..., 2] = 232, 242, 255  # isblå hvit
rgba[..., 3] = (alpha * 255).astype(np.uint8)
Image.fromarray(rgba, "RGBA").save(out, "WEBP", quality=85, method=6)

# Forhåndsvisning mot skjermens mørkeblå bakgrunn.
bg = Image.new("RGBA", (W, H), (10, 18, 32, 255))
Image.alpha_composite(bg, Image.open(out).convert("RGBA")).convert("RGB").save(preview, quality=85)
print("alfa snitt", float(alpha.mean()))
