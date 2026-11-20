import type { Clock } from '../shared/domain/clock.js';

/** FR-34: rendered pages are reused for 5 minutes, so a pack price change shows within 5 min. */
export const PAGE_CACHE_TTL_MS = 5 * 60_000;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/** A tiny in-memory cache with a TTL, keyed by page variant (e.g. `/` + tab). */
export class PageCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs: number = PAGE_CACHE_TTL_MS,
  ) {}

  async getOrCreate(key: string, create: () => Promise<T>): Promise<T> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    const value = await create();
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }
}
