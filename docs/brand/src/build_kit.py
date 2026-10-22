"""Build the Export Component Metadata logo kit into <out>/ (docs/brand)."""
import os
import sys

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

import mark as M

FONT = sys.argv[2]
OUT = sys.argv[1]

PALETTE = {
    "violet": "#5B3FEF",    # diamond and value line on light; brand colour
    "lavender": "#B99BFF",  # diamond and value line on dark
    "graphite": "#1D1D1F",  # key line and type on light
    "mist": "#F5F5F7",      # key line and type on dark
}
SCHEMES = {  # diamond + value line, key line
    "color": (PALETTE["violet"], PALETTE["graphite"]),
    "on-dark": (PALETTE["lavender"], PALETTE["mist"]),
    "black": ("#000000", "#000000"),
    "white": ("#FFFFFF", "#FFFFFF"),
    "violet": (PALETTE["violet"], PALETTE["violet"]),
}

font = TTFont(FONT)
upem = font["head"].unitsPerEm
cap = font["OS/2"].sCapHeight
glyphs = font.getGlyphSet()
blob = hb.Blob.from_file_path(FONT)
hbfont = hb.Font(hb.Face(blob))
TRACK = -0.01 * upem  # slight negative tracking, display size


def text_path(text, size, x0, baseline):
    """Shape with HarfBuzz (kerning), outline with fontTools. Returns (path d, advance width)."""
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    k = size / upem
    pen = SVGPathPen(glyphs)
    x = 0
    order = font.getGlyphOrder()
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        t = TransformPen(pen, (k, 0, 0, -k, x0 + (x + pos.x_offset) * k, baseline - pos.y_offset * k))
        glyphs[name].draw(t)
        x += pos.x_advance + TRACK
    return pen.getCommands(), (x - TRACK) * k


def symbol_group(diamond, key, x, y_center, height):
    """Mark scaled so the diamond (tip to tip) is `height` tall, left edge at x."""
    s = height / (M.BOTTOM - M.TOP)
    return (f'<g transform="translate({x:.2f} {y_center:.2f}) scale({s:.4f}) translate({-M.LEFT:.2f} {-M.CY})">'
            f'{M.paths(diamond, key, diamond)}</g>'), (M.RIGHT - M.LEFT) * s


def svg(w, h, body, title="Export Component Metadata"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}">'
            f'<title>{title}</title>{body}</svg>\n')


def write(rel, content):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(content)


SIZE = 100                  # type size (px) for lockups
CAP = cap * SIZE / upem     # cap height in px
PAD = CAP                   # clear space = cap height


def horizontal(diamond, key, text_color):
    sym_h = CAP * 1.75
    gap = sym_h * 0.42
    y_c = PAD + sym_h / 2
    g, sym_w = symbol_group(diamond, key, PAD, y_c, sym_h)
    d, tw = text_path("Export Component Metadata", SIZE, PAD + sym_w + gap, y_c + CAP / 2)
    w, h = PAD + sym_w + gap + tw + PAD, sym_h + 2 * PAD
    return svg(w, h, g + f'<path fill="{text_color}" d="{d}"/>')


def stacked(diamond, key, text_color):
    sym_h = CAP * 3.0
    d1, w1 = text_path("Export Component", SIZE, 0, 0)
    d2, w2 = text_path("Metadata", SIZE, 0, 0)
    sym_w = (M.RIGHT - M.LEFT) * sym_h / (M.BOTTOM - M.TOP)
    width = max(w1, w2, sym_w) + 2 * PAD
    y_c = PAD + sym_h / 2
    g, _ = symbol_group(diamond, key, (width - sym_w) / 2, y_c, sym_h)
    base1 = PAD + sym_h + sym_h * 0.4 + CAP
    base2 = base1 + SIZE * 1.2
    d1, _ = text_path("Export Component", SIZE, (width - w1) / 2, base1)
    d2, _ = text_path("Metadata", SIZE, (width - w2) / 2, base2)
    return svg(width, base2 + PAD + SIZE * 0.05, g + f'<path fill="{text_color}" d="{d1}{d2}"/>')


for scheme, (dia, key) in SCHEMES.items():
    write(f"symbol/symbol-{scheme}.svg", M.flat_symbol(diamond=dia, key=key))
    write(f"lockup/horizontal-{scheme}.svg", horizontal(dia, key, key))
    write(f"lockup/stacked-{scheme}.svg", stacked(dia, key, key))

for ap in M.APPEARANCES:
    write(f"icon/icon-{ap}.svg", M.app_icon(appearance=ap))
    write(f"icon/icon-{ap}-rounded.svg", M.app_icon(shape="squircle", appearance=ap))
print("ok")
