import { TEXT_MAX, replyBody, type ReplyBody, type TicketDetail } from '@app/contracts/support';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type KeyboardEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Banner, Button, Field, Textarea } from '../../../../shared/ui';
import { copy, fill } from '../../copy';
import { useReply } from '../api/hooks';
import { formatDay } from '../lib/format';
import { isApiError } from '../lib/form-errors';
import { NewTicketLink } from './new-ticket-button';

export interface ComposerProps {
  ticket: TicketDetail;
  /** The reply was saved; the page moves focus to the new message. */
  onSent: () => void;
  onClose: () => void;
  /** The server said the reopen window has passed (409). */
  closedTooLongAt: string | null;
  onTooLong: (closedAt: string) => void;
}

/** FR-4: the reply box with "Close ticket"; or the new-ticket prompt after the reopen window. */
export function Composer({ ticket, onSent, onClose, closedTooLongAt, onTooLong }: ComposerProps) {
  const reply = useReply(ticket.number);
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<ReplyBody>({
    resolver: zodResolver(replyBody, { error: () => copy.replyEmpty }),
    defaultValues: { message: '' },
  });
  const { register, handleSubmit, reset, formState } = form;

  const tooLong =
    closedTooLongAt ?? (!ticket.canReply && !ticket.readOnly ? ticket.closedAt : null);
  if (tooLong) {
    const params = new URLSearchParams({ category: ticket.category });
    if (ticket.run) params.set('runId', ticket.run.id);
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-4 py-4 text-sm text-fg-2 md:px-7">
        <span>{fill(copy.closedTooLong, { date: formatDay(tooLong) })}</span>
        <NewTicketLink search={params.toString()} />
      </div>
    );
  }

  const locked = ticket.readOnly;
  const submit = handleSubmit((body) => {
    setProblem(null);
    reply.mutate(body.message, {
      onSuccess: () => {
        reset({ message: '' });
        onSent();
      },
      onError: (error) => {
        if (isApiError(error, 409, 'TICKET_CLOSED_TOO_LONG')) {
          const at = error.details?.closedAt;
          onTooLong(typeof at === 'string' ? at : (ticket.closedAt ?? new Date().toISOString()));
        } else if (isApiError(error, 429)) setProblem(copy.replyTooMany);
        else setProblem(copy.replyFailed);
      },
    });
  });

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!locked && !reply.isPending) void submit();
    }
  }

  return (
    <form
      noValidate
      aria-label={copy.reply}
      onSubmit={(e) => void submit(e)}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2.5 border-t border-line px-3 pb-3.5 pt-2.5 md:px-7 md:pb-6 md:pt-4"
    >
      {locked && <Banner>{copy.readOnly}</Banner>}
      {ticket.status === 'closed' && ticket.reopenUntil && !locked && (
        <p className="m-0 text-[13px] text-muted">
          {fill(copy.closedNote, { date: formatDay(ticket.reopenUntil) })}
        </p>
      )}
      <Field label={copy.reply} error={formState.errors.message?.message}>
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            maxLength={TEXT_MAX + 100}
            placeholder={copy.replyPlaceholder}
            disabled={locked}
            {...register('message')}
          />
        )}
      </Field>
      {problem && <Banner tone="warn">{problem}</Banner>}
      <div className="flex items-center justify-between">
        {ticket.canClose || locked ? (
          <Button variant="ghost" disabled={locked} onClick={onClose} className="h-11 md:h-10">
            {copy.closeTicket}
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="submit"
          variant="primary"
          loading={reply.isPending}
          disabled={locked}
          className="h-11 text-[15px] md:h-10 md:text-sm"
        >
          {copy.sendReply}
          <span aria-hidden="true" className="font-mono text-[11px] opacity-70 max-md:hidden">
            ⌘↵
          </span>
        </Button>
      </div>
    </form>
  );
}
