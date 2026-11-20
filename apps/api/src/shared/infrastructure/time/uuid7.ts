import { randomBytes } from 'node:crypto';
import type { IdGenerator } from '../../domain/id-generator.js';

/**
 * UUID v7 (RFC 9562): 48-bit unix millis, then random bits, so ids sort by creation time. With
 * `counter` (12 bits, RFC 9562 method 1) ids made in the same millisecond sort in order too.
 */
export function uuidv7(now: number = Date.now(), counter?: number): string {
  const bytes = randomBytes(16);
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  if (counter !== undefined) {
    bytes[6] = (counter >> 8) & 0x0f;
    bytes[7] = counter & 0xff;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const MAX_COUNTER = 0xfff;

/**
 * Monotonic within the process: ids made in the same millisecond (a Profile's Products saved
 * together, say) sort in the order they were made, so `ORDER BY created_at, id` is stable.
 */
export class Uuid7Generator implements IdGenerator {
  private lastMs = -1;
  private counter = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  next(): string {
    const now = this.clock();
    if (now > this.lastMs) {
      this.lastMs = now;
      this.counter = 0;
    } else if (this.counter < MAX_COUNTER) {
      this.counter += 1;
    } else {
      // 4,096 ids in one millisecond: borrow the next one rather than lose the order.
      this.lastMs += 1;
      this.counter = 0;
    }
    return uuidv7(this.lastMs, this.counter);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `00000000-0000-7000-8000-${this.n.toString(16).padStart(12, '0')}`;
  }
}
