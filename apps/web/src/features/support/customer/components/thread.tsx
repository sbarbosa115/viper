import { statusLabels, type CustomerMessage } from '@app/contracts/support';
import { forwardRef } from 'react';
import { cx } from '../../../../shared/ui';
import { copy, fill } from '../../copy';
import { formatStamp, formatTime } from '../lib/format';

function Message({ message }: { message: CustomerMessage }) {
  if (message.kind === 'status_event') {
    const label = message.status ? statusLabels[message.status].toUpperCase() : '';
    return (
      <li
        tabIndex={-1}
        className="text-center font-mono text-[11px] text-faint outline-none md:text-xs"
      >
        {fill(copy.statusEvent, { status: label, time: formatTime(message.createdAt) })}
      </li>
    );
  }
  const customer = message.kind === 'customer_reply';
  const name = message.author?.name ?? copy.support;
  return (
    <li
      tabIndex={-1}
      className={cx('flex flex-col outline-none', customer ? 'items-end' : 'items-start')}
    >
      <div
        className={cx(
          'max-w-[300px] text-sm leading-relaxed md:max-w-[480px] md:text-[15px]',
          customer
            ? 'rounded-card bg-raised px-3 py-2.5 text-fg md:px-3.5 md:py-3'
            : 'max-w-[320px] text-fg-2 md:max-w-[620px]',
        )}
      >
        {!customer && (
          <p className="m-0 mb-1 text-xs text-muted">
            {name} · <time dateTime={message.createdAt}>{formatStamp(message.createdAt)}</time>
          </p>
        )}
        {/* Plain text, never HTML or Markdown; line breaks are kept. */}
        <p className="m-0 whitespace-pre-wrap break-words">{message.body}</p>
        {customer && (
          <p className="m-0 mt-1.5 text-right font-mono text-[11px] text-muted">
            {name} · <time dateTime={message.createdAt}>{formatStamp(message.createdAt)}</time>
          </p>
        )}
      </div>
    </li>
  );
}

/** The conversation, oldest first, as an ordered list with author and time in text (NFR-3). */
export const Thread = forwardRef<HTMLOListElement, { messages: CustomerMessage[] }>(function Thread(
  { messages },
  ref,
) {
  return (
    <ol
      ref={ref}
      aria-label={copy.threadLabel}
      className="m-0 flex list-none flex-col gap-4 p-0 md:gap-[18px]"
    >
      {messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}
    </ol>
  );
});
