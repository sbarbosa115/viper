import { creditWallet as walletExample } from '@app/contracts/examples';
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, test } from 'vitest';
import { server } from '../../test/setup';
import { creditsQueryKey, refreshCreditsUntilChanged } from './me';

describe('shared: credits refresh after email verification', () => {
  test('re-reads the balance until it changes and leaves it in the cache', async () => {
    const reads: number[] = [0, 0, 50];
    let calls = 0;
    server.use(
      http.get('*/api/credits', () => {
        const available = reads[Math.min(calls, reads.length - 1)] ?? 0;
        calls += 1;
        return HttpResponse.json({ ...walletExample, balance: available, reserved: 0, available });
      }),
    );
    const client = new QueryClient();
    await refreshCreditsUntilChanged(client, 0, { everyMs: 5, timeoutMs: 1_000 });
    expect(calls).toBe(3);
    expect(client.getQueryData<{ available: number }>(creditsQueryKey)?.available).toBe(50);
  });

  test('gives up after the timeout when nothing changes', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/credits', () => {
        calls += 1;
        return HttpResponse.json({ ...walletExample, balance: 0, reserved: 0, available: 0 });
      }),
    );
    await refreshCreditsUntilChanged(new QueryClient(), 0, { everyMs: 10, timeoutMs: 35 });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThanOrEqual(5);
  });
});
