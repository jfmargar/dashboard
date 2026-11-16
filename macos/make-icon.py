# Genera macos/AppIcon.icns: un panel pixel-art con la oficina (quién trabaja y quién te espera),
# las misiones y la bandeja. Se dibuja en una rejilla de 32×32 y se escala sin suavizar.
# Requiere Pillow e iconutil (viene con macOS).
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

G = 32  # rejilla lógica
CANVAS = 1024
PLATE = 832  # tamaño del icono dentro del lienzo, como los de macOS
PX = PLATE // G

# Paleta de la app (public/styles.css)
BG = (20, 22, 28)
SURFACE = (28, 31, 39)
LINE = (44, 49, 62)
TEXT = (232, 234, 240)
WORKING = (95, 211, 141)
YOURS = (242, 193, 78)
IDLE = (91, 98, 116)
CLAUDE = (217, 119, 87)
CODEX = (142, 162, 255)
FLOOR = (92, 70, 54)
FLOOR2 = (100, 77, 60)
DESK = (122, 84, 54)
DESK_DARK = (74, 50, 34)
SKIN = (241, 194, 160)


def draw():
    im = Image.new("RGBA", (G, G), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    def r(x0, y0, x1, y1, c):  # rectángulo inclusivo en celdas
        d.rectangle((x0, y0, x1, y1), fill=c)

    # Placa con esquinas escalonadas
    r(2, 0, G - 3, G - 1, BG)
    r(1, 1, G - 2, G - 2, BG)
    r(0, 2, G - 1, G - 3, BG)

    # Barra superior: tres pestañas
    r(3, 3, 8, 4, TEXT)
    r(10, 3, 14, 4, IDLE)
    r(16, 3, 19, 4, IDLE)
    r(26, 3, 28, 4, YOURS)  # aviso

    # Panel grande: la oficina
    r(3, 7, 18, 28, SURFACE)
    for y in range(8, 28):
        for x in range(4, 18):
            d.point((x, y), FLOOR if (x // 2 + y // 2) % 2 else FLOOR2)
    for ox, oy, dot, shirt, hair in ((5, 10, WORKING, CLAUDE, (30, 26, 28)), (11, 18, YOURS, CODEX, (176, 98, 44))):
        r(ox + 2, oy - 3, ox + 3, oy - 2, dot)  # estado encima de la cabeza
        r(ox + 1, oy, ox + 4, oy + 1, hair)  # pelo
        r(ox + 1, oy + 2, ox + 4, oy + 3, SKIN)  # cara
        r(ox + 1, oy + 2, ox + 1, oy + 2, hair)
        r(ox + 4, oy + 2, ox + 4, oy + 2, hair)
        r(ox, oy + 4, ox + 5, oy + 6, shirt)  # cuerpo
        r(ox - 1, oy + 7, ox + 6, oy + 8, DESK)  # mesa
        r(ox - 1, oy + 9, ox + 6, oy + 9, DESK_DARK)

    # Panel de misiones: lista con casillas
    r(20, 7, 28, 16, SURFACE)
    for i, (done, w) in enumerate(((True, 5), (True, 3), (False, 4))):
        y = 9 + i * 2
        r(21, y, 21, y, WORKING if done else IDLE)
        r(23, y, 22 + w, y, TEXT if not done else IDLE)

    # Panel de bandeja: el sobre de la pestaña Bandeja, con aviso
    r(20, 18, 28, 28, SURFACE)
    r(21, 22, 27, 22, TEXT)
    r(21, 27, 27, 27, TEXT)
    r(21, 23, 21, 26, TEXT)
    r(27, 23, 27, 26, TEXT)
    for x, y in ((22, 23), (23, 24), (24, 25), (25, 24), (26, 23)):
        d.point((x, y), TEXT)
    r(26, 19, 28, 21, YOURS)  # globo de avisos
    return im


def icon(path):
    art = draw().resize((PLATE, PLATE), Image.NEAREST)
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    off = (CANVAS - PLATE) // 2
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 110), (off, off + 14), art.split()[3])
    out.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18)))
    out.alpha_composite(art, (off, off))
    out.save(path)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    tmp = tempfile.mkdtemp()
    master = os.path.join(tmp, "master.png")
    icon(master)
    iconset = os.path.join(tmp, "AppIcon.iconset")
    os.makedirs(iconset)
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            px = size * scale
            Image.open(master).resize((px, px), Image.LANCZOS).save(
                os.path.join(iconset, f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(here, "AppIcon.icns")], check=True)
    print(master)
