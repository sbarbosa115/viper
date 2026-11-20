import { me, type Me } from '@app/contracts/identity';
import { creditWallet } from '@app/contracts/billing';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../shared/api/client';

export const meQueryKey = ['me'] as const;
export const creditsQueryKey = ['credits'] as const;

/** 401 means signed out. 404 is treated the same until the identity module serves /api/auth/me. */
function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 404);
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
