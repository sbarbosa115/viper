import {
  confirmPasswordReset,
  login,
  signup,
  twoFactorSetup,
  twoFactorVerify,
  verifyEmail,
  type LoginBody,
  type Me,
  type SignupBody,
} from '@app/contracts/identity';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meQueryKey, readCredits, refreshCreditsUntilChanged } from '../../../shared/api/me';
import { api, apiAccepted } from '../../../shared/api/client';

/** Seeds the signed-in Member so guards and the shell see the session without another request. */
export function useCommitMe() {
  const client = useQueryClient();
  return (me: Me) => client.setQueryData(meQueryKey, me);
}

export function useSignup() {
  return useMutation({
    mutationFn: (body: SignupBody) =>
      api('/auth/signup', { method: 'POST', body, schema: signup.response }),
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: (body: LoginBody) =>
      api('/auth/login', { method: 'POST', body, schema: login.response }),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => client.clear(),
  });
}

/**
 * Opens the emailed link once per token; success refreshes the Member and keeps re-reading the
 * wallet for up to 10 s, because the trial grant lands a moment later (outbox and worker).
 */
export function useVerifyEmail(token: string | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: ['verify-email', token],
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const before = await readCredits(client);
      const result = await api('/auth/verify-email', {
        method: 'POST',
        body: { token },
        schema: verifyEmail.response,
      });
      await client.invalidateQueries({ queryKey: meQueryKey });
      void refreshCreditsUntilChanged(client, before);
      return result;
    },
  });
}

export { useResendVerification } from '../../../shared/api/verification';

/** First Staff login: the QR code and key. Requested once; a refetch would replace the secret. */
export function useTwoFactorSetup(enabled: boolean) {
  return useQuery({
    queryKey: ['two-factor-setup'],
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: () =>
      api('/auth/two-factor/setup', { method: 'POST', schema: twoFactorSetup.response }),
  });
}

export function useTwoFactorVerify() {
  return useMutation({
    mutationFn: (code: string) =>
      api('/auth/two-factor/verify', {
        method: 'POST',
        body: { code },
        schema: twoFactorVerify.response,
      }),
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) =>
      apiAccepted('/auth/password-reset', { method: 'POST', body: { email } }),
  });
}

export function useConfirmPasswordReset() {
  return useMutation({
    mutationFn: (body: { token: string; password: string }) =>
      api('/auth/password-reset/confirm', {
        method: 'POST',
        body,
        schema: confirmPasswordReset.response,
      }),
  });
}
