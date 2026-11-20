import { useState } from 'react';
import { useMe } from '../../../shared/api/me';
import { Banner, Button } from '../../../shared/ui';
import { useResendVerification } from '../api/hooks';
import { copy } from '../copy';
import { isApiError } from '../lib/form-errors';

/**
 * FR-2: the slim notice shown to a signed-in Member until the email is verified.
 * The shell mounts it above the page content; it renders nothing otherwise.
 */
export function UnverifiedNotice() {
  const { me } = useMe();
  const resend = useResendVerification();
  const [message, setMessage] = useState<string | null>(null);

  if (!me || me.member.emailVerified || me.actingAs) return null;

  const onResend = () =>
    resend.mutate(undefined, {
      onSuccess: () => setMessage(copy.notice.sent),
      onError: (error) =>
        setMessage(isApiError(error, 429) ? copy.notice.tooMany : copy.notice.failed),
    });

  return (
    <Banner
      action={
        <Button size="sm" variant="secondary" loading={resend.isPending} onClick={onResend}>
          {copy.notice.resend}
        </Button>
      }
    >
      {copy.notice.text}
      {message && <span className="ml-2 text-muted"> · {message}</span>}
    </Banner>
  );
}
