#!/usr/bin/env python3
"""Draw the Atrium icon: a chambered nautilus.

Run with `npm run icon`. Writes build/icon.png (the 1024 master, used for
Windows and Linux), build/icon.iconset + build/icon.icns (macOS, which wants
different artwork per size), and public/favicon.svg.

Everything is generated from one set of parameters rather than drawn by hand,
so the raster and vector marks cannot drift apart.
"""

import zlib, struct, math, sys, os
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

# ── orientation ──────────────────────────────────────────────────────────
#
# The aperture is a single radial step in the outline: at one angle the
# boundary drops by a whole growth factor, because that is where the outermost
# whorl ends and the one beneath it is showing. Unrotated that step lands on
# the +x axis, which cuts a flat horizontal line out to the edge of the mark
# and leaves the lower-right quadrant empty — it reads as a bite taken out of
# a ring rather than as a shell seen in section. Turning the whole shell puts
# the aperture at the lower left, where the outline carries the eye around the
# spiral instead of stopping it dead.
#
# Applied in three places, all through the two helpers below: _fit measures the
# rotated outline, sample() turns canvas points back into shell space, and the
# SVG projects through the same rotation, so the raster and vector marks cannot
# drift apart.
#
# One angle for every variant. The aperture is the th = 0 discontinuity, which
# is where it is because th is taken modulo a turn — not somewhere that moves
# with TURNS — so the same rotation aims it the same way at every size.
ROT = math.radians(145)

def _rot(x, y):
    """Shell space to canvas orientation."""
    c, s = math.cos(ROT), math.sin(ROT)
    return x * c - y * s, x * s + y * c

def _unrot(x, y):
    """Canvas orientation back to shell space."""
    c, s = math.cos(ROT), math.sin(ROT)
    return x * c + y * s, -x * s + y * c

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
        x, y = _rot(r * math.cos(th), r * math.sin(th))
        xs.append(x)
        ys.append(y)
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    scale = (BODY - 2 * PAD * BODY) / max(x1 - x0, y1 - y0)
    return scale, 0.5 - (x0 + x1) / 2 * scale, 0.5 - (y0 + y1) / 2 * scale

def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def age_colour(age):
    """Oldest chamber to newest, over however much of the ramp this size uses."""
    a = RAMP_FROM + (1 - RAMP_FROM) * age
    return lerp(OLD, MID, a / 0.62) if a < 0.62 else lerp(MID, NEW, (a - 0.62) / 0.38)

# ── the macOS icon grid ──────────────────────────────────────────────────
#
# An app icon does not fill its canvas. Apple's grid puts the rounded body at
# roughly 80% of the square with transparent margin around it, and every icon
# in the Dock is drawn to that footprint — so one that runs edge to edge sits
# visibly larger than its neighbours, which is exactly how this one looked.
BODY = 0.805                 # body width as a fraction of the canvas
BODY_RADIUS = 0.225          # corner radius as a fraction of the body
SHADOW_DROP = 0.014          # how far the shadow sits below the body
SHADOW_BLUR = 0.030
SHADOW_ALPHA = 0.30

def sd_round_rect(px, py, half, r):
    """Signed distance to a rounded square centred on the origin."""
    qx, qy = abs(px) - half + r, abs(py) - half + r
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    return outside + min(max(qx, qy), 0.0) - r

def body_distance(nx, ny):
    """Signed distance from the icon body, in canvas fractions."""
    return sd_round_rect(nx - 0.5, ny - 0.5, BODY / 2, BODY * BODY_RADIUS)

def rounded(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1: return False
    if x0 + r <= x <= x1 - r or y0 + r <= y <= y1 - r: return True
    cx = x0 + r if x < x0 + r else x1 - r
    cy = y0 + r if y < y0 + r else y1 - r
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def sample(nx, ny):
    """nx, ny in 0..1 on the canvas."""
    dx, dy = _unrot((nx - OFF_X) / SCALE, (ny - OFF_Y) / SCALE)
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
            nx, ny = (x + 0.5) / W, (y + 0.5) / W
            if body_distance(nx, ny) <= 0:
                c = sample(nx, ny)
                line.append(((c if c is not None else BG), 255))
            else:
                # Outside the body: a soft shadow, then nothing.
                d = sd_round_rect(nx - 0.5, ny - 0.5 - SHADOW_DROP,
                                  BODY / 2, BODY * BODY_RADIUS)
                if d < SHADOW_BLUR:
                    t = 1 - max(d, 0.0) / SHADOW_BLUR
                    line.append(((0, 0, 0), round(255 * SHADOW_ALPHA * t * t)))
                else:
                    line.append(None)
        grid.append(line)
    for oy in range(S):
        row = bytearray([0])
        for ox in range(S):
            r = g = b = a = 0
            for dy in range(SS):
                line = grid[oy * SS + dy]
                for dx in range(SS):
                    px = line[ox * SS + dx]
                    if px is None: continue
                    (cr, cg, cb), ca = px
                    # Premultiplied accumulation, so a soft shadow edge does
                    # not drag the colour toward black.
                    r += cr * ca; g += cg * ca; b += cb * ca; a += ca
            if a == 0:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((r // a, g // a, b // a, a // n))
        rows.append(bytes(row))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag+data) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(b''.join(rows), 9))
        + chunk(b'IEND', b''))
    print('  png', path)

def write_icns(path, iconset='build/icon.iconset'):
    """Pack the iconset into an .icns.

    `iconutil` is the canonical tool and is macOS-only, which left the mac
    artwork frozen at whatever a mac last generated while every other target
    moved on — exactly the kind of drift the single-source-of-truth parameters
    above exist to prevent. The container is simple enough to write directly:
    a magic, a total length, then type/length/payload records holding the PNGs
    unmodified.
    """
    TYPES = [('icp4', 'icon_16x16.png'),    ('ic11', 'icon_16x16@2x.png'),
             ('icp5', 'icon_32x32.png'),    ('ic12', 'icon_32x32@2x.png'),
             ('ic07', 'icon_128x128.png'),  ('ic13', 'icon_128x128@2x.png'),
             ('ic08', 'icon_256x256.png'),  ('ic14', 'icon_256x256@2x.png'),
             ('ic09', 'icon_512x512.png'),  ('ic10', 'icon_512x512@2x.png')]
    body = b''
    for tag, name in TYPES:
        data = open(os.path.join(iconset, name), 'rb').read()
        body += tag.encode('ascii') + struct.pack('>I', len(data) + 8) + data
    open(path, 'wb').write(b'icns' + struct.pack('>I', len(body) + 8) + body)
    print('  icns', path)

# ── vector, from the same numbers ────────────────────────────────────────
def render_svg(path, U=32):
    hexc = lambda c: '#%02x%02x%02x' % c
    step = TAU / PER_TURN
    bw = BODY * U
    parts = [f'<rect x="{(U-bw)/2:.2f}" y="{(U-bw)/2:.2f}" width="{bw:.2f}" '
             f'height="{bw:.2f}" rx="{bw*BODY_RADIUS:.2f}" fill="{hexc(BG)}"/>']
    def px(x, y):
        rx, ry = _rot(x, y)
        return (rx * SCALE + OFF_X) * U, (ry * SCALE + OFF_Y) * U
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

    # Linux reads a directory of exact sizes out of the hicolor theme rather
    # than one master PNG. electron-builder installs whatever sizes it finds
    # here and nothing else, so a lone 1024 master installs only a 1024 icon —
    # which menus and task switchers do not look for, and the app appears with
    # no icon at all. Same artwork policy as the .iconset: densest variant that
    # still reads at that size.
    LINUX_SIZES = [(16, 'small'), (24, 'small'), (32, 'small'), (48, 'medium'),
                   (64, 'medium'), (128, 'medium'), (256, 'large'),
                   (512, 'large'), (1024, 'large')]
    os.makedirs('build/icons', exist_ok=True)
    for size, variant in LINUX_SIZES:
        use(variant)
        render_png(f'build/icons/{size}x{size}.png', S=size, SS=4 if size <= 64 else 3)

    write_icns('build/icon.icns')

    use('large')
    render_png(target, S=1024, SS=3)
    use('medium')
    render_svg('public/favicon.svg')
