import { crc32, deflateSync } from 'node:zlib';
import { midnightTokens, shareImagePath } from '../../../web/src/site/index.js';

export { shareImagePath };

/*
 * The Open Graph / Twitter share image (FR-34): 1200×630 PNG drawn in code, so it needs no
 * image tooling or binary asset. Midnight background, the Llyner wordmark and icon (drawn from
 * the same coordinates as docs/brand/llyner-leads-dark.svg and llyner-icon-dark.svg)
 * and a tagline in a 5×7 pixel font.
 */

const WIDTH = 1200;
const HEIGHT = 630;
type Rgb = readonly [number, number, number];

function hex(token: keyof typeof midnightTokens): Rgb {
  const v = midnightTokens[token];
  const n = Number.parseInt(v.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const GLYPHS: Record<string, readonly string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

class Canvas {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT * 3);

  fill(
    x0: number,
    y0: number,
    w: number,
    h: number,
    color: Rgb,
    inside?: (x: number, y: number) => boolean,
  ) {
    for (let y = Math.max(0, y0); y < Math.min(HEIGHT, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(WIDTH, x0 + w); x++) {
        if (inside && !inside(x - x0, y - y0)) continue;
        const i = (y * WIDTH + x) * 3;
        this.pixels[i] = color[0];
        this.pixels[i + 1] = color[1];
        this.pixels[i + 2] = color[2];
      }
    }
  }

  /** Blends `color` into the pixels where the signed distance `dist` is <= 0, with soft edges. */
  paint(
    box: { x0: number; y0: number; x1: number; y1: number },
    dist: (x: number, y: number) => number,
    color: Rgb,
  ) {
    for (let y = Math.max(0, Math.floor(box.y0)); y < Math.min(HEIGHT, Math.ceil(box.y1)); y++) {
      for (let x = Math.max(0, Math.floor(box.x0)); x < Math.min(WIDTH, Math.ceil(box.x1)); x++) {
        const cover = Math.min(1, Math.max(0, 0.5 - dist(x + 0.5, y + 0.5)));
        if (cover === 0) continue;
        const i = (y * WIDTH + x) * 3;
        for (let k = 0; k < 3; k++) {
          const from = this.pixels[i + k] ?? 0;
          this.pixels[i + k] = Math.round(from + ((color[k] ?? 0) - from) * cover);
        }
      }
    }
  }

  disc(cx: number, cy: number, r: number, color: Rgb) {
    this.paint(
      { x0: cx - r - 1, y0: cy - r - 1, x1: cx + r + 1, y1: cy + r + 1 },
      (x, y) => Math.hypot(x - cx, y - cy) - r,
      color,
    );
  }

  ring(cx: number, cy: number, r: number, width: number, color: Rgb) {
    const o = r + width;
    this.paint(
      { x0: cx - o, y0: cy - o, x1: cx + o, y1: cy + o },
      (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) - width / 2,
      color,
    );
  }

  /**
   * A straight stroke. Horizontal and vertical ones get square ends, which fill the corner where
   * two strokes meet (as SVG miter joins do); diagonal ones get flat ends so they don't poke out.
   */
  line(ax: number, ay: number, bx: number, by: number, width: number, color: Rgb) {
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const h = width / 2;
    const cap = ax === bx || ay === by ? h : 0;
    this.paint(
      {
        x0: Math.min(ax, bx) - width,
        y0: Math.min(ay, by) - width,
        x1: Math.max(ax, bx) + width,
        y1: Math.max(ay, by) + width,
      },
      (x, y) => {
        const along = (x - ax) * ux + (y - ay) * uy;
        const across = Math.abs((x - ax) * -uy + (y - ay) * ux);
        return Math.max(Math.abs(along - len / 2) - (len / 2 + cap), across - h);
      },
      color,
    );
  }

  /** A curve given as points, drawn as round-ended strokes between them. */
  polyline(points: readonly (readonly [number, number])[], width: number, color: Rgb) {
    const h = width / 2;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1] ?? [0, 0];
      const [bx, by] = points[i] ?? [0, 0];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      this.paint(
        {
          x0: Math.min(ax, bx) - width,
          y0: Math.min(ay, by) - width,
          x1: Math.max(ax, bx) + width,
          y1: Math.max(ay, by) + width,
        },
        (x, y) => {
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
          return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) - h;
        },
        color,
      );
    }
  }

  roundedRect(x: number, y: number, size: number, radius: number, color: Rgb) {
    this.fill(x, y, size, size, color, (dx, dy) => {
      const cx = Math.min(Math.max(dx, radius), size - radius - 1);
      const cy = Math.min(Math.max(dy, radius), size - radius - 1);
      return (dx - cx) ** 2 + (dy - cy) ** 2 <= radius ** 2;
    });
  }

  text(text: string, x: number, y: number, scale: number, color: Rgb) {
    let cursor = x;
    for (const char of text) {
      const rows = GLYPHS[char] ?? GLYPHS[' '] ?? [];
      rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] === '1') this.fill(cursor + c * scale, y + r * scale, scale, scale, color);
        }
      });
      cursor += 6 * scale;
    }
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(canvas: Canvas): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour RGB
  const stride = WIDTH * 3;
  const raw = Buffer.alloc((stride + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(canvas.pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

type Pt = readonly [number, number];

/** The upper half of a circle, left to right (an SVG arc with sweep 1 over the top). */
function upperArc(cx: number, cy: number, r: number, steps = 48): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = Math.PI + (Math.PI * i) / steps;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps = 24): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return [
      u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
      u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
    ] as const;
  });
}

const BRAND_BLUE: Rgb = [0x18, 0x77, 0xf2];
const FACE_BLUE: Rgb = [0x4c, 0x9a, 0xff];
const WHITE: Rgb = [0xff, 0xff, 0xff];

/** docs/brand/llyner-logo-dark.svg (viewBox 50 40 694 300) at (left, top), `scale` px per unit. */
function drawWordmark(canvas: Canvas, left: number, top: number, scale: number, ink: Rgb) {
  const P = ([x, y]: Pt): Pt => [left + (x - 50) * scale, top + (y - 40) * scale];
  const line = (a: Pt, b: Pt, w: number, c: Rgb) => {
    const [ax, ay] = P(a);
    const [bx, by] = P(b);
    canvas.line(ax, ay, bx, by, w * scale, c);
  };

  // The face peeking over the word.
  line([280.5, 177], [280.5, 163.5], 16, FACE_BLUE);
  line([490.5, 177], [490.5, 163.5], 16, FACE_BLUE);
  canvas.polyline(upperArc(385.5, 163.5, 105, 96).map(P), 16 * scale, FACE_BLUE);
  canvas.polyline(upperArc(349, 152, 17.5).map(P), 12 * scale, FACE_BLUE);
  canvas.polyline(upperArc(421.5, 152, 17.5).map(P), 12 * scale, FACE_BLUE);

  // L L Y N E R
  const w = 16;
  for (const x of [62, 183]) {
    line([x, 194], [x, 327], w, ink);
    line([x, 327], [x + 69.5, 327], w, ink);
  }
  line([285.5, 194], [328, 276], w, ink);
  line([371, 194], [328, 276], w, ink);
  line([328, 276], [328, 331.5], w, ink);
  line([414.5, 331.5], [414.5, 194], w, ink);
  line([414.5, 194], [484.5, 331.5], w, ink);
  line([484.5, 331.5], [484.5, 194], w, ink);
  line([613, 198], [543, 198], w, ink);
  line([543, 198], [543, 327], w, ink);
  line([543, 327], [612.5, 327], w, ink);
  line([543, 258.5], [601.5, 258.5], w, ink);
  line([662, 331.5], [662, 198], w, ink);
  line([662, 198], [704, 198], w, ink);
  canvas.polyline(
    [
      ...cubic([704, 198], [722, 198], [730.5, 211], [730.5, 230]),
      ...cubic([730.5, 230], [730.5, 249], [722, 262], [704, 262]),
    ].map(P),
    w * scale,
    ink,
  );
  line([704, 262], [662, 262], w, ink);
  line([701, 262], [732.5, 331.5], w, ink);
}

/** LEADS in the wordmark's strokes, as in docs/brand/llyner-leads-dark.svg. */
function drawLeads(canvas: Canvas, left: number, top: number, scale: number, ink: Rgb) {
  const P = ([x, y]: Pt): Pt => [left + (x - 50) * scale, top + (y - 40) * scale];
  const w = 16 * scale;
  const path = (pts: Pt[]) => canvas.polyline(pts.map(P), w, ink);
  const line = (a: Pt, b: Pt) => {
    const [ax, ay] = P(a);
    const [bx, by] = P(b);
    canvas.line(ax, ay, bx, by, w, ink);
  };
  line([840, 194], [840, 327]);
  line([840, 327], [909.5, 327]);
  line([1029, 198], [959, 198]);
  line([959, 198], [959, 327]);
  line([959, 327], [1028.5, 327]);
  line([959, 258.5], [1017.5, 258.5]);
  line([1078, 331.5], [1104, 198]);
  line([1104, 198], [1124, 198]);
  line([1124, 198], [1150, 331.5]);
  line([1088, 280], [1140, 280]);
  line([1200, 198], [1200, 327]);
  path([
    [1200, 198],
    ...cubic([1235, 198], [1262, 198], [1272, 225], [1272, 262.5]),
    ...cubic([1272, 262.5], [1272, 300], [1262, 327], [1235, 327]),
    [1200, 327],
  ]);
  path([
    ...cubic([1390, 212], [1382, 201], [1370, 198], [1356, 198]),
    ...cubic([1356, 198], [1336, 198], [1324, 209], [1324, 227]),
    ...cubic([1324, 227], [1324, 246], [1340, 252], [1357, 258]),
    ...cubic([1357, 258], [1376, 265], [1390, 272], [1390, 293]),
    ...cubic([1390, 293], [1390, 315], [1374, 327], [1354, 327]),
    ...cubic([1354, 327], [1338, 327], [1326, 321], [1320, 310]),
  ]);
}

/** docs/brand/llyner-icon-dark.svg (150×150) with its top-left corner at (left, top). */
function drawIcon(canvas: Canvas, left: number, top: number, size: number) {
  const s = size / 150;
  canvas.disc(left + 75 * s, top + 75 * s, 75 * s, BRAND_BLUE);
  canvas.ring(left + 75 * s, top + 75 * s, 64 * s, 4 * s, WHITE);
  for (const cx of [47.5, 101.5]) {
    canvas.polyline(
      upperArc(cx, 81, 12.5).map(([x, y]) => [left + x * s, top + y * s] as const),
      9 * s,
      WHITE,
    );
  }
}

let cached: Buffer | null = null;

export function shareImagePng(): Buffer {
  if (cached) return cached;
  const canvas = new Canvas();
  canvas.fill(0, 0, WIDTH, HEIGHT, hex('--bg'));
  canvas.fill(0, 0, WIDTH, 2, hex('--line'));
  const left = 96;
  // The LLYNER LEADS lockup (docs/brand/llyner-leads-dark.svg).
  const scale = 0.72;
  drawWordmark(canvas, left, 110, scale, hex('--text'));
  drawLeads(canvas, left, 110, scale, hex('--text-muted'));
  canvas.text('VERIFIED LOCAL B2B LEADS', left, 430, 5, hex('--text-muted'));
  canvas.fill(left, 520, 160, 6, hex('--accent'));
  drawIcon(canvas, 1000, 420, 104);
  cached = encodePng(canvas);
  return cached;
}

/** The Llyner icon as an SVG favicon (docs/brand/llyner-icon-dark.svg). */
export function iconSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150"><circle cx="75" cy="75" r="75" fill="#1877F2"/><circle cx="75" cy="75" r="64" fill="none" stroke="#FFFFFF" stroke-width="4"/><path d="M35 81A12.5 12.5 0 0 1 60 81M89 81A12.5 12.5 0 0 1 114 81" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round"/></svg>';
}
