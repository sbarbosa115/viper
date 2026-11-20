import { crc32, deflateSync } from 'node:zlib';
import { midnightTokens, shareImagePath } from '../../../web/src/site/index.js';

export { shareImagePath };

/*
 * The Open Graph / Twitter share image (FR-34): 1200×630 PNG drawn in code, so it needs no
 * image tooling or binary asset. Midnight background, the lime logo mark, the wordmark and a
 * tagline in a 5×7 pixel font.
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

let cached: Buffer | null = null;

export function shareImagePng(): Buffer {
  if (cached) return cached;
  const canvas = new Canvas();
  canvas.fill(0, 0, WIDTH, HEIGHT, hex('--bg'));
  canvas.fill(0, 0, WIDTH, 2, hex('--line'));
  const left = 96;
  // Logo mark: a lime rounded square with the "L" stroke (DESIGN.md).
  canvas.roundedRect(left, 150, 110, 30, hex('--accent'));
  canvas.fill(left + 32, 178, 13, 56, hex('--accent-ink'));
  canvas.fill(left + 32, 221, 46, 13, hex('--accent-ink'));
  canvas.text('LLYNER LEADS', left, 310, 12, hex('--text'));
  canvas.text('VERIFIED LOCAL B2B LEADS', left, 430, 5, hex('--text-muted'));
  canvas.fill(left, 520, 160, 6, hex('--accent'));
  cached = encodePng(canvas);
  return cached;
}

/** The Llyner icon as an SVG favicon (docs/brand/llyner-icon-dark.svg). */
export function iconSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150"><circle cx="75" cy="75" r="75" fill="#1877F2"/><circle cx="75" cy="75" r="64" fill="none" stroke="#FFFFFF" stroke-width="4"/><path d="M35 81A12.5 12.5 0 0 1 60 81M89 81A12.5 12.5 0 0 1 114 81" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round"/></svg>';
}
