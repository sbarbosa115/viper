import { categoryLabels, type TicketSummary } from '@app/contracts/support';
import { Link } from 'react-router';
import { cx } from '../../../../shared/ui';
import { copy, fill } from '../../copy';
import { formatDay, formatUpdated } from '../lib/format';
import { StatusWord } from './status-word';

const columns = {
  from: 'md:grid-cols-[64px_minmax(0,1fr)_170px_130px_140px_64px]',
  noFrom: 'md:grid-cols-[64px_minmax(0,1fr)_170px_140px_64px]',
};

function previewText(ticket: TicketSummary): string | null {
  if (ticket.preview) {
    return fill(copy.previewLine, {
      author: ticket.preview.authorName,
      text: ticket.preview.text,
    });
  }
  return ticket.closedAt ? fill(copy.closedOn, { date: formatDay(ticket.closedAt) }) : null;
}

/** Column heads, desktop only; the rows below carry the same words in text. */
export function TicketHead({ showFrom }: { showFrom: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        'hidden gap-x-4 border-b border-line px-4 py-2.5 text-xs font-medium text-muted md:grid',
        showFrom ? columns.from : columns.noFrom,
      )}
    >
      <span>{copy.colNumber}</span>
      <span>{copy.colSubject}</span>
      <span>{copy.colCategory}</span>
      {showFrom && <span>{copy.colFrom}</span>}
      <span>{copy.colStatus}</span>
      <span className="text-right">{copy.colUpdated}</span>
    </div>
  );
}

/** One ticket: a stacked card on mobile, a table-like row on desktop (one DOM for both). */
export function TicketRow({ ticket, showFrom }: { ticket: TicketSummary; showFrom: boolean }) {
  const preview = previewText(ticket);
  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        to={`/support/${ticket.number}`}
        className={cx(
          'grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-4 py-3.5 text-sm text-fg-2 hover:bg-surface md:items-start',
          showFrom ? columns.from : columns.noFrom,
        )}
      >
        <span className="col-start-1 row-start-1 flex gap-1.5 font-mono text-xs text-muted md:contents">
          <span className="md:order-1 md:text-sm">#{ticket.number}</span>
          <span aria-hidden="true" className="md:hidden">
            ·
          </span>
          <span className="font-sans md:order-3 md:text-sm md:text-fg-2">
            {categoryLabels[ticket.category]}
          </span>
        </span>
        <span className="col-span-2 row-start-2 flex min-w-0 flex-col gap-0.5 md:order-2 md:col-auto md:row-auto">
          <b className="text-[15px] font-semibold text-fg md:text-sm">{ticket.subject}</b>
          {preview && <span className="text-[13px] text-muted">{preview}</span>}
          {ticket.run && (
            <span className="text-[13px] text-muted">
              {fill(copy.linkedRun, { plan: ticket.run.planName })}
            </span>
          )}
        </span>
        {showFrom && (
          <span className="col-span-2 row-start-3 text-[13px] text-muted md:order-4 md:col-auto md:row-auto md:text-sm md:text-fg-2">
            <span className="md:hidden">
              {fill(copy.fromMember, { name: ticket.openedBy.name })}
            </span>
            <span className="hidden md:inline">{ticket.openedBy.name}</span>
          </span>
        )}
        <span className="col-start-2 row-start-1 justify-self-end md:order-5 md:col-auto md:row-auto md:justify-self-start">
          <StatusWord status={ticket.status} />
        </span>
        <time
          dateTime={ticket.lastMessageAt}
          className="col-span-2 row-start-4 font-mono text-xs text-muted md:order-6 md:col-auto md:row-auto md:text-right"
        >
          {formatUpdated(ticket.lastMessageAt)}
        </time>
      </Link>
    </li>
  );
}
