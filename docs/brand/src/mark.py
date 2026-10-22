"""Key–value mark geometry (256 grid) and the app icon.

The component diamond sits next to two lines: a key and its value. Every measure comes from the diamond:
the key line is as long as the diamond's side, the value line is the key divided by the golden ratio, and one
gutter separates every piece.
"""
import math

# ---- geometry -------------------------------------------------------------
H = 60          # diamond half-diagonal
OVER = 1.5      # the pointed tips overshoot a touch, so the diamond looks as tall as it is
R = 14          # corner fillet length
T = 24          # line thickness
GAP = 14        # the one gutter: between the lines, and between the diamond and the lines
CY = 128
PHI = (1 + 5 ** .5) / 2
KEY = H * 2 ** .5          # key line = side of the diamond
VALUE = KEY / PHI          # value line = key / phi
OFF = T / 2 + GAP / 2      # line centres, above and below the axis


def f(p):
    return f"{p[0]:.2f} {p[1]:.2f}"


def rounded(pts, r=R, k=0.6, samples=None):
    """Polygon with cubic fillets. Long handles (k) give a smoother, nearly continuous curve than a circular arc."""
    n, fil = len(pts), []
    for i, (x, y) in enumerate(pts):
        (px, py), (nx, ny) = pts[i - 1], pts[(i + 1) % n]
        l1, l2 = math.hypot(px - x, py - y), math.hypot(nx - x, ny - y)
        a = (x + (px - x) / l1 * r, y + (py - y) / l1 * r)
        b = (x + (nx - x) / l2 * r, y + (ny - y) / l2 * r)
        fil.append((a, (a[0] + (x - a[0]) * k, a[1] + (y - a[1]) * k), (b[0] + (x - b[0]) * k, b[1] + (y - b[1]) * k), b))
    if samples is not None:  # outline points, used to measure the optical gutter
        for i, (a, c1, c2, b) in enumerate(fil):
            a2 = fil[(i + 1) % n][0]
            for j in range(41):
                u, m = j / 40, 1 - j / 40
                samples.append((m ** 3 * a[0] + 3 * m * m * u * c1[0] + 3 * m * u * u * c2[0] + u ** 3 * b[0],
                                m ** 3 * a[1] + 3 * m * m * u * c1[1] + 3 * m * u * u * c2[1] + u ** 3 * b[1]))  # fillet
                samples.append((b[0] + (a2[0] - b[0]) * u, b[1] + (a2[1] - b[1]) * u))  # straight edge
    s = f"M{f(fil[0][3])}"
    for i in range(1, n + 1):
        a, c1, c2, b = fil[i % n]
        s += f"L{f(a)}C{f(c1)} {f(c2)} {f(b)}"
    return s + "Z"


def pill(x1, x2, yc, t=T):
    r = t / 2
    return (f"M{x1 + r:.2f} {yc - r:.2f}H{x2 - r:.2f}A{r} {r} 0 0 1 {x2 - r:.2f} {yc + r:.2f}"
            f"H{x1 + r:.2f}A{r} {r} 0 0 1 {x1 + r:.2f} {yc - r:.2f}Z")


def _layout():
    he = H + OVER
    pts = []
    dia = rounded([(0, CY - he), (he, CY), (0, CY + he), (-he, CY)], samples=pts)
    # Slide the lines in until the nearest point of the rounded diamond is exactly one gutter away,
    # so the space beside the diamond matches the space between the lines.
    x0 = he + T
    for _ in range(60):
        d = min(math.hypot(px - x0, py - (CY - OFF)) for px, py in pts) - T / 2
        x0 -= (d - GAP) * .8
    start = x0 - T / 2
    reach = max(px for px, _ in pts)  # where the rounded tips actually end
    shift = (256 - (start + KEY + reach)) / 2 + reach  # centre the whole mark on the 256 grid
    return shift, start, he, reach


CX, _START, _HE, _REACH = _layout()
LEFT, RIGHT = CX - _REACH, CX + _START + KEY
TOP, BOTTOM = CY - _REACH, CY + _REACH
DIAMOND = rounded([(CX, CY - _HE), (CX + _HE, CY), (CX, CY + _HE), (CX - _HE, CY)])
KEY_LINE = pill(CX + _START, CX + _START + KEY, CY - OFF)
VALUE_LINE = pill(CX + _START, CX + _START + VALUE, CY + OFF)
BBOX_CX = (LEFT + RIGHT) / 2


def paths(diamond, key, value):
    return (f'<path fill="{key}" d="{KEY_LINE}"/><path fill="{value}" d="{VALUE_LINE}"/>'
            f'<path fill="{diamond}" d="{DIAMOND}"/>')


def flat_symbol(diamond="#5B3FEF", key="#1D1D1F", value=None, title="Export Component Metadata", crop=True):
    """Flat master symbol. The value line shares the diamond's colour unless told otherwise."""
    pad = 6
    vb = f"{LEFT - pad:.2f} {TOP - pad:.2f} {RIGHT - LEFT + 2 * pad:.2f} {BOTTOM - TOP + 2 * pad:.2f}" if crop else "0 0 256 256"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><title>{title}</title>'
            f'{paths(diamond, key, value or diamond)}</svg>\n')


# ---- App icon --------------------------------------------------------------
APPEARANCES = {
    # tile top/bottom, diamond + value, key, top-edge highlight opacity
    "default": dict(bg=("#6A4DFA", "#4B2FE2"), dia="#FFFFFF", key="#1D1D1F", rim=.22),
    "dark": dict(bg=("#2A2A2E", "#141416"), dia="#B99BFF", key="#F5F5F7", rim=.10),
}


def app_icon(size=1024, shape="square", appearance="default", mark_width=0.64):
    """Flat glyph on a softly lit tile. shape: 'square' (full bleed, for Figma) or 'squircle' (rounded, transparent outside)."""
    a = APPEARANCES[appearance]
    s = mark_width * size / (RIGHT - LEFT)
    tr = f"translate({size / 2:.1f} {size / 2:.1f}) scale({s:.4f}) translate({-BBOX_CX:.2f} {-CY})"
    rx = size * 0.225 if shape == "squircle" else 0
    clip = f'<clipPath id="tile"><rect width="{size}" height="{size}" rx="{rx:.1f}"/></clipPath>'
    hair = size / 512
    # a hairline of light along the top edge, only where the tile has its own corners (full bleed gets cropped by the host)
    rim = (f'<rect x="{hair / 2:.2f}" y="{hair / 2:.2f}" width="{size - hair:.2f}" height="{size - hair:.2f}" rx="{rx - hair / 2:.1f}" '
           f'fill="none" stroke="url(#rim)" stroke-width="{hair:.2f}"/>' if rx else "")
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
<title>Export Component Metadata</title>
<defs>
  {clip}
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{a['bg'][0]}"/><stop offset="1" stop-color="{a['bg'][1]}"/></linearGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="{a['rim']}"/><stop offset=".12" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<g clip-path="url(#tile)">
  <rect width="{size}" height="{size}" fill="url(#bg)"/>
  {rim}
  <g transform="{tr}">{paths(a['dia'], a['key'], a['dia'])}</g>
</g>
</svg>
"""


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    for ap in APPEARANCES:
        open(f"{out}/icon-{ap}.svg", "w").write(app_icon(appearance=ap))
        open(f"{out}/icon-{ap}-squircle.svg", "w").write(app_icon(shape="squircle", appearance=ap))
    open(f"{out}/flat-color.svg", "w").write(flat_symbol())
    print("ok")
