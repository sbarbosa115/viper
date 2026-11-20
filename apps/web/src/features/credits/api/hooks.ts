import { createCheckout, creditWallet, ledgerEntry } from '@app/contracts/billing';
import { page } from '@app/contracts/common';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { creditsQueryKey } from '../../../shared/api/me';
import { api } from '../../../shared/api/client';

const ledgerPage = page(ledgerEntry);
const ledgerKey = [...creditsQueryKey, 'ledger'] as const;

/** The wallet; the header pill reads the same query. */
export function useWallet() {
  return useQuery({
    queryKey: creditsQueryKey,
    queryFn: () => api('/credits', { schema: creditWallet }),
    retry: false,
  });
}

/** The ledger, newest first, 25 per page. */
export function useLedger() {
  return useInfiniteQuery({
    queryKey: ledgerKey,
    retry: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: '25' });
      if (pageParam) query.set('cursor', pageParam);
      return api(`/credits/ledger?${query.toString()}`, { schema: ledgerPage });
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (packId: string) =>
      api('/credits/checkout', { method: 'POST', body: { packId }, schema: createCheckout.response }),
  });
}

export const POLL_EVERY_MS = 3000;
export const POLL_FOR_MS = 60_000;

export type PurchaseState = 'idle' | 'waiting' | 'done' | 'timeout';

/**
 * FR-12: after Stripe sends the Member back, the webhook may not have landed yet. Refresh the
 * wallet and ledger every 3 s for up to 60 s, until the balance goes up.
 */
export function usePurchasePolling(active: boolean, balance: number | undefined): PurchaseState {
  const client = useQueryClient();
  const [state, setState] = useState<PurchaseState>(active ? 'waiting' : 'idle');
  const baseline = useRef<number | null>(null);

  useEffect(() => {
    if (balance === undefined) return;
    baseline.current ??= balance;
    if (state === 'waiting' && balance > baseline.current) setState('done');
  }, [balance, state]);

  useEffect(() => {
    if (state !== 'waiting') return;
    const tick = setInterval(() => {
      void client.invalidateQueries({ queryKey: creditsQueryKey });
    }, POLL_EVERY_MS);
    const stop = setTimeout(() => setState('timeout'), POLL_FOR_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [state, client]);

  return state;
}
