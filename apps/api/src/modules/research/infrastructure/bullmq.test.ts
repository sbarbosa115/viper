import { afterEach, describe, expect, test, vi } from 'vitest';
import { intervalHeartbeat } from './bullmq.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('FR-36: lease heartbeat', () => {
  test('a failed renewal is logged, not swallowed, and the next beat still runs', async () => {
    vi.useFakeTimers();
    const warnings: { obj: object; msg: string }[] = [];
    const logger = { warn: (obj: object, msg: string) => void warnings.push({ obj, msg }) };
    let beats = 0;
    const stop = intervalHeartbeat(logger).start(() => {
      beats += 1;
      return beats === 1 ? Promise.reject(new Error('Lock wait timeout')) : Promise.resolve();
    }, 30_000);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(beats).toBe(2);
    expect(warnings).toEqual([
      { obj: { err: new Error('Lock wait timeout') }, msg: 'research lease renewal failed' },
    ]);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(beats).toBe(2);
  });
});
