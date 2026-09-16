#!/usr/bin/env python3
"""Draw the Atrium icon: a chambered nautilus.

Run with `npm run icon`. Writes build/icon.png (the 1024 master, used for
Windows and Linux), build/icon.iconset + build/icon.icns (macOS, which wants
different artwork per size), and public/favicon.svg.

Everything is generated from one set of parameters rather than drawn by hand,
so the raster and vector marks cannot drift apart.
"""

import zlib, struct, math, sys
TAU = math.pi * 2

# ── the shell, as one set of parameters used for both the raster icon and
#    the vector favicon, so the two cannot drift apart ────────────────────
# One shell, drawn at three levels of detail.
#
# A chambered spiral has fine structure near the pole that simply cannot
# survive being 32 pixels wide — downscaling the detailed artwork produced
# noise twice, at two different densities. macOS icons have always solved this
# by shipping different artwork per size rather than one image resized, so
# that is what these are: the same spiral, redrawn with fewer and broader
# chambers as the canvas shrinks.
# The colour ramp shortens as the canvas does. At 1024 the oldest chambers can
# sit in near-darkness and still read as chambers; at 32 they are simply
# indistinguishable from the background, and the mark half-disappears. So the
# small variants keep every chamber bright and let the septa do the dividing.
VARIANTS = {
    # name:    turns, growth, per_turn, wall_r, wall_a, core,  pad,   ramp_from
    #
    # Growth is the parameter that decides whether a size works. A large jump
    # per whorl gives the handsome deep spiral, but it also makes the inner
    # whorl a few pixels across — so at small sizes only the outermost chamber
    # survives and the mark reads as a blob. The small variants stay near one
    # whorl, where every chamber is a comparable size.
    'small':  (1.00,  2.10,   4,        0.100,  0.160,  0.050, 0.060, 0.62),
    'medium': (1.45,  2.45,   5,        0.095,  0.150,  0.055, 0.070, 0.34),
    'large':  (2.05,  2.95,   6,        0.090,  0.135,  0.070, 0.075, 0.00),
}

TURNS = GROWTH = PER_TURN = WALL_R = WALL_A = CORE = PAD = RAMP_FROM = None
B = A = SCALE = OFF_X = OFF_Y = None

def use(variant):
    global TURNS, GROWTH, PER_TURN, WALL_R, WALL_A, CORE, PAD, RAMP_FROM
    global B, A, SCALE, OFF_X, OFF_Y
    TURNS, GROWTH, PER_TURN, WALL_R, WALL_A, CORE, PAD, RAMP_FROM = VARIANTS[variant]
    B = math.log(GROWTH) / TAU
    A = 1.0
    SCALE, OFF_X, OFF_Y = _fit()


BG   = (0x0b, 0x0d, 0x10)
NEW  = (0xe8, 0xf3, 0xff)
MID  = (0x7a, 0xa2, 0xf7)
OLD  = (0x24, 0x2e, 0x3d)
CORE_C = (0x1c, 0x27, 0x39)

def _outer_radius(th):
    """Outer edge of the shell at angle th."""
    return A * math.exp(B * (th + TAU * TURNS))

def _fit():
    """Scale and centre the shell from its own bounding box.

    A spiral's mass is nowhere near its pole, and guessing the offset left a
    quarter of the canvas empty. Measuring the outline is the only way to sit
    it properly in the square.
    """
    xs, ys = [0.0], [0.0]
    for i in range(2048):
        th = TAU * i / 2048
        r = _outer_radius(th)
        xs.append(r * math.cos(th))
        ys.append(r * math.sin(th))
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    scale = (1 - 2 * PAD) / max(x1 - x0, y1 - y0)
    return scale, 0.5 - (x0 + x1) / 2 * scale, 0.5 - (y0 + y1) / 2 * scale

def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def age_colour(age):
    """Oldest chamber to newest, over however much of the ramp this size uses."""
    a = RAMP_FROM + (1 - RAMP_FROM) * age
    return lerp(OLD, MID, a / 0.62) if a < 0.62 else lerp(MID, NEW, (a - 0.62) / 0.38)

def rounded(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1: return False
    if x0 + r <= x <= x1 - r or y0 + r <= y <= y1 - r: return True
    cx = x0 + r if x < x0 + r else x1 - r
    cy = y0 + r if y < y0 + r else y1 - r
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def sample(nx, ny):
    """nx, ny in 0..1 on the canvas."""
    dx, dy = (nx - OFF_X) / SCALE, (ny - OFF_Y) / SCALE
    r = math.hypot(dx, dy)
    if r < CORE:
        return CORE_C
    th = math.atan2(dy, dx) % TAU
    k = (math.log(r / A) / B - th) / TAU
    if k < 0 or k > TURNS: return None
    frac = k - math.floor(k)
    if frac < WALL_R or frac > 1 - WALL_R: return None
    phi = th + TAU * math.floor(k)
    step = TAU / PER_TURN
    if (phi % step) / step < WALL_A: return None
    return age_colour(phi / (TAU * TURNS))

# ── raster ───────────────────────────────────────────────────────────────
def render_png(path, S=1024, SS=3):
    W = S * SS
    rows, n = [], SS * SS
    grid = []
    for y in range(W):
        line = []
        for x in range(W):
            if not rounded(x, y, 0, 0, W - 1, W - 1, W * 0.225):
                line.append(None)
            else:
                c = sample(x / W, y / W)
                line.append(c if c is not None else BG)
        grid.append(line)
    for oy in range(S):
        row = bytearray([0])
        for ox in range(S):
            r = g = b = cov = 0
            for dy in range(SS):
                line = grid[oy * SS + dy]
                for dx in range(SS):
                    px = line[ox * SS + dx]
                    if px is None: continue
                    r += px[0]; g += px[1]; b += px[2]; cov += 1
            row += bytes((0,0,0,0)) if cov == 0 else bytes((r//cov, g//cov, b//cov, cov*255//n))
        rows.append(bytes(row))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag+data) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
        + chunk(b'IEND', b''))
    print('  png', path)

# ── vector, from the same numbers ────────────────────────────────────────
def render_svg(path, U=32):
    hexc = lambda c: '#%02x%02x%02x' % c
    step = TAU / PER_TURN
    parts = [f'<rect width="{U}" height="{U}" rx="{U*0.22:.2f}" fill="{hexc(BG)}"/>']
    px = lambda x, y: ((x * SCALE + OFF_X) * U, (y * SCALE + OFF_Y) * U)
    total = int(TURNS * PER_TURN)
    for i in range(total):
        phi0 = i * step + step * WALL_A
        phi1 = (i + 1) * step
        pts = []
        # outer edge of this chamber, then back along the inner edge
        for t in [j / 12 for j in range(13)]:
            phi = phi0 + (phi1 - phi0) * t
            r = A * math.exp(B * phi) * (1 - WALL_R)
            pts.append(px(r * math.cos(phi), r * math.sin(phi)))
        for t in [j / 12 for j in range(13)]:
            phi = phi1 - (phi1 - phi0) * t
            r = max(A * math.exp(B * (phi - TAU)) * (1 + WALL_R), CORE)
            pts.append(px(r * math.cos(phi), r * math.sin(phi)))
        d = ' '.join(f'{x:.2f},{y:.2f}' for x, y in pts)
        parts.append(f'<polygon points="{d}" fill="{hexc(age_colour(phi1/(TAU*TURNS)))}"/>')
    ox, oy = px(0, 0)
    parts.append(f'<circle cx="{ox:.2f}" cy="{oy:.2f}" r="{CORE*SCALE*U:.2f}" fill="{hexc(CORE_C)}"/>')
    open(path, 'w').write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {U} {U}">\n  '
        + '\n  '.join(parts) + '\n</svg>\n')
    print('  svg', path)

if __name__ == '__main__':
    import os
    print('nautilus:')
    target = sys.argv[1] if len(sys.argv) > 1 else 'build/icon.png'

    # macOS wants an .iconset of exact sizes; each takes the densest variant
    # that still reads at that size.
    SIZES = [(16, 'small'), (32, 'small'), (64, 'medium'), (128, 'medium'),
             (256, 'large'), (512, 'large'), (1024, 'large')]
    os.makedirs('build/icon.iconset', exist_ok=True)
    NAMES = {16: ['icon_16x16.png'], 32: ['icon_16x16@2x.png', 'icon_32x32.png'],
             64: ['icon_32x32@2x.png'], 128: ['icon_128x128.png'],
             256: ['icon_128x128@2x.png', 'icon_256x256.png'],
             512: ['icon_256x256@2x.png', 'icon_512x512.png'],
             1024: ['icon_512x512@2x.png']}
    for size, variant in SIZES:
        use(variant)
        ss = 4 if size <= 64 else 3
        first = 'build/icon.iconset/' + NAMES[size][0]
        render_png(first, S=size, SS=ss)
        for extra in NAMES[size][1:]:
            open('build/icon.iconset/' + extra, 'wb').write(open(first, 'rb').read())

    use('large')
    render_png(target, S=1024, SS=3)
    use('medium')
    render_svg('public/favicon.svg')
