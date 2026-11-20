import { useMutation } from '@tanstack/react-query';
import { apiAccepted } from './client';

/**
 * FR-2: sends a new verification email to the signed-in Member. Shared because features other
 * than auth (the notice, the new plan page) offer Resend where a verified email is needed.
 */
export function useResendVerification() {
  return useMutation({
    mutationFn: () => apiAccepted('/auth/verify-email/resend', { method: 'POST' }),
  });
}
