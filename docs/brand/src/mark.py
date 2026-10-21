"""Unfold mark geometry (256 grid) and the layered-glass app icon."""
import math

# ---- geometry -------------------------------------------------------------
H = 52          # diamond half-diagonal
T = 22          # line thickness
GAP = 40        # distance between line centres
LEFT, RIGHT = 34, 226
CY = 128
CX = LEFT + H   # diamond centre x
LINES = ((158, RIGHT), (CX - 10, RIGHT), (158, 200))  # top, middle (runs from the tip), bottom
BBOX_CX = (LEFT + RIGHT) / 2


def f(p):
    return f"{p[0]:.2f} {p[1]:.2f}"


def rdiamond(cx=CX, cy=CY, h=H, r=8):
    pts = [(cx, cy - h), (cx + h, cy), (cx, cy + h), (cx - h, cy)]
    c = []
    for i, (x, y) in enumerate(pts):
        px, py = pts[i - 1]
        nx, ny = pts[(i + 1) % 4]
        L = math.hypot(px - x, py - y)
        c.append(((x + (px - x) / L * r, y + (py - y) / L * r), (x, y),
                  (x + (nx - x) / L * r, y + (ny - y) / L * r)))
    s = f"M{f(c[0][2])}"
    for i in range(1, 5):
        a, v, b = c[i % 4]
        s += f"L{f(a)}Q{f(v)} {f(b)}"
    return s + "Z"


def bar(x1, x2, yc, t=T):
    r = t / 2
    return (f"M{x1 + r:.2f} {yc - r:.2f}H{x2 - r:.2f}A{r} {r} 0 0 1 {x2 - r:.2f} {yc + r:.2f}"
            f"H{x1 + r:.2f}A{r} {r} 0 0 1 {x1 + r:.2f} {yc - r:.2f}Z")


DIAMOND = rdiamond()
BARS = "".join(bar(x1, x2, y) for (x1, x2), y in zip(LINES, (CY - GAP, CY, CY + GAP)))


def flat_symbol(diamond="#9747FF", lines="#1E1E1E", title="Export Component Metadata", crop=True):
    """Flat master symbol. crop=True tightens the viewBox around the mark (+ padding)."""
    vb = f"{LEFT - 6} {CY - H - 6} {RIGHT - LEFT + 12} {2 * H + 12}" if crop else "0 0 256 256"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><title>{title}</title>'
            f'<path fill="{lines}" d="{BARS}"/><path fill="{diamond}" d="{DIAMOND}"/></svg>\n')


# ---- App icon (Apple-style layered glass, restrained) ----------------------
APPEARANCES = {
    # background top/bottom, diamond top/bottom, lines colour + opacity, rim opacity, shadow opacity
    "default": dict(bg=("#6248F5", "#4A2FE0"), dia=("#FFFFFF", "#ECE6FF"), lines=("#FFFFFF", .78), rim=.9, shadow=.16),
    "dark": dict(bg=("#232326", "#141416"), dia=("#B99BFF", "#8E62FF"), lines=("#F2F2F7", .82), rim=.55, shadow=.35),
}


def glass_icon(size=1024, shape="square", appearance="default", mark_width=0.6, cy=0.5):
    """shape: 'square' (full bleed, for Figma) or 'squircle' (rounded corners, transparent outside)."""
    a = APPEARANCES[appearance]
    s = mark_width * size / (RIGHT - LEFT)
    tr = f"translate({size / 2:.1f} {size * cy:.1f}) scale({s:.4f}) translate({-BBOX_CX} {-CY})"
    clip, attr = "", ""
    if shape == "squircle":
        clip = f'<clipPath id="tile"><rect width="{size}" height="{size}" rx="{size * 0.225:.1f}"/></clipPath>'
        attr = ' clip-path="url(#tile)"'
    top, bottom = CY - H, CY + H
    lc, lo = a["lines"]
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
<title>Export Component Metadata</title>
<defs>
  {clip}
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{a['bg'][0]}"/><stop offset="1" stop-color="{a['bg'][1]}"/></linearGradient>
  <linearGradient id="dia" gradientUnits="userSpaceOnUse" x1="0" y1="{top}" x2="0" y2="{bottom}"><stop offset="0" stop-color="{a['dia'][0]}"/><stop offset="1" stop-color="{a['dia'][1]}"/></linearGradient>
  <linearGradient id="rim" gradientUnits="userSpaceOnUse" x1="0" y1="{top}" x2="0" y2="{bottom}"><stop offset="0" stop-color="#fff" stop-opacity="{a['rim']}"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="barRim" gradientUnits="userSpaceOnUse" x1="0" y1="{CY - GAP - T / 2}" x2="0" y2="{CY + GAP + T / 2}"><stop offset="0" stop-color="#fff" stop-opacity="{a['rim']}"/><stop offset="1" stop-color="#fff" stop-opacity="{a['rim'] * .35:.2f}"/></linearGradient>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
  <clipPath id="dclip"><path d="{DIAMOND}"/></clipPath>
  <clipPath id="bclip"><path d="{BARS}"/></clipPath>
</defs>
<g{attr}>
  <rect width="{size}" height="{size}" fill="url(#bg)"/>
  <g transform="{tr}">
    <g filter="url(#shadow)" opacity="{a['shadow']}" transform="translate(0 3)"><path d="{BARS}"/><path d="{DIAMOND}"/></g>
    <path fill="{lc}" fill-opacity="{lo}" d="{BARS}"/>
    <g clip-path="url(#bclip)"><path fill="none" stroke="url(#barRim)" stroke-width="1.6" d="{BARS}"/></g>
    <path fill="url(#dia)" d="{DIAMOND}"/>
    <g clip-path="url(#dclip)"><path fill="none" stroke="url(#rim)" stroke-width="2" d="{DIAMOND}"/></g>
  </g>
</g>
</svg>
"""


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    for ap in APPEARANCES:
        open(f"{out}/icon-{ap}.svg", "w").write(glass_icon(appearance=ap))
        open(f"{out}/icon-{ap}-squircle.svg", "w").write(glass_icon(shape="squircle", appearance=ap))
    open(f"{out}/flat-color.svg", "w").write(flat_symbol())
    print("ok")
