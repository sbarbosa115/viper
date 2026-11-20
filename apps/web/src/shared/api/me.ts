import { me, type Me } from '@app/contracts/identity';
import { creditWallet } from '@app/contracts/billing';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';

export const meQueryKey = ['me'] as const;
export const creditsQueryKey = ['credits'] as const;

/** 401 means signed out. */
function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export interface MeState {
  me: Me | null;
  isLoading: boolean;
  isSignedOut: boolean;
  /** An error that is not "signed out" (network, 5xx). */
  error: unknown;
  refetch: () => void;
}

/** The signed-in Member (GET /api/auth/me). Guards and shells read it from here. */
export function useMe(): MeState {
  const query = useQuery({
    queryKey: meQueryKey,
    queryFn: () => api('/auth/me', { schema: me }),
    retry: false,
  });
  const signedOut = query.isError && isSignedOut(query.error);
  return {
    me: query.data ?? null,
    isLoading: query.isPending,
    isSignedOut: signedOut,
    error: query.isError && !signedOut ? query.error : null,
    refetch: () => void query.refetch(),
  };
}

/** Available credits for the header pill; null while loading or unavailable. */
export function useCreditBalance(enabled: boolean): number | null {
  const query = useQuery({
    queryKey: creditsQueryKey,
    queryFn: () => api('/credits', { schema: creditWallet }),
    enabled,
    retry: false,
  });
  return query.data?.available ?? null;
}

/** The current available balance, read fresh into the cache (null when it can't be read). */
export function readCredits(client: QueryClient): Promise<number | null> {
  return client
    .fetchQuery({
      queryKey: creditsQueryKey,
      queryFn: () => api('/credits', { schema: creditWallet }),
      staleTime: 0,
      retry: false,
    })
    .then((wallet) => wallet.available)
    .catch(() => null);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Re-reads the balance until it differs from `baseline` (e.g. the trial grant after email
 * verification lands through the outbox and the worker), at most `timeoutMs`. Every read updates
 * the `creditsQueryKey` cache, so the header pill follows.
 */
export async function refreshCreditsUntilChanged(
  client: QueryClient,
  baseline: number | null,
  options: { timeoutMs?: number; everyMs?: number } = {},
): Promise<void> {
  const { timeoutMs = 10_000, everyMs = 1_000 } = options;
  const until = Date.now() + timeoutMs;
  for (;;) {
    const now = await readCredits(client);
    if (now !== null && now !== baseline) return;
    if (Date.now() + everyMs > until) return;
    await wait(everyMs);
  }
}
