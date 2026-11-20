import type { Lead } from '@app/contracts/leads';
import { useSetFeedback } from './hooks';

/** FR-27 actions for one Lead. Choosing the current value again clears it. */
export function useFeedbackActions(lead: Lead | undefined) {
  const mutation = useSetFeedback(lead?.id ?? '');
  const send = (value: 'good' | 'not_fit' | null, reason?: string) => {
    if (!lead) return;
    mutation.mutate(reason === undefined ? { value } : { value, reason });
  };
  return {
    good: () => send(lead?.feedback === 'good' ? null : 'good'),
    notFit: () => send(lead?.feedback === 'not_fit' ? null : 'not_fit'),
    clear: () => send(null),
    setReason: (reason: string | undefined) => send('not_fit', reason),
    pending: mutation.isPending,
    failed: mutation.isError,
  };
}

export type FeedbackActions = ReturnType<typeof useFeedbackActions>;
