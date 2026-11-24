import { staffStatusLabel, type StaffMessage } from '@app/contracts/support';
import { cx } from '../../../../shared/ui';
import { copy } from '../copy';
import { formatTime } from '../lib/format';

function who(message: StaffMessage, meId: string | undefined): string {
  const name = message.author?.name ?? '';
  return message.author?.id === meId ? copy.youSupport : copy.staffAs(name);
}

function eventText(message: StaffMessage, meId: string | undefined): string {
  const e = message.event;
  const actor = message.author?.id === meId ? 'You' : (message.author?.name ?? '');
  if (!e) return '';
  switch (e.type) {
    case 'taken':
      return copy.takenBy(actor);
    case 'assigned':
      return copy.assignedToEvent(e.to ? (e.to.id === meId ? 'You' : e.to.name) : null);
    case 'status_changed':
      return `${staffStatusLabel(e.from)} → ${staffStatusLabel(e.to)}`;
    case 'reopened':
      return copy.reopened;
  }
}

const bubble = 'rounded-row border px-4 py-3 text-sm text-fg-2';

/** FR-7: customer replies, Staff replies, Internal notes and events, oldest first. */
export function Thread({ messages, meId }: { messages: StaffMessage[]; meId: string | undefined }) {
  return (
    <ol aria-label={copy.threadLabel} className="m-0 flex list-none flex-col gap-3 p-0">
      {messages.map((m) => {
        const time = formatTime(m.createdAt);
        if (m.kind === 'event') {
          return (
            <li key={m.id} className="text-center font-mono text-xs text-faint">
              {eventText(m, meId)} · {time}
            </li>
          );
        }
        if (m.kind === 'internal_note') {
          return (
            <li key={m.id} className={cx(bubble, 'border-dashed border-warn/60 bg-warn/5')}>
              <p className="m-0 mb-1 font-mono text-xs text-warn">
                {copy.internalNote} · {m.author?.id === meId ? 'You' : m.author?.name} · {time}
              </p>
              <p className="m-0 whitespace-pre-wrap">{m.body}</p>
            </li>
          );
        }
        const staff = m.kind === 'staff_reply';
        return (
          <li
            key={m.id}
            className={cx(
              bubble,
              staff
                ? 'border-accent-line bg-accent-tint-weak md:ml-10'
                : 'border-line-strong bg-surface md:mr-10',
            )}
          >
            <p className="m-0 mb-1 font-mono text-xs text-muted">
              {staff ? who(m, meId) : m.author?.name} · {time}
              {staff && m.emailed && ` · ${copy.emailed}`}
            </p>
            <p className="m-0 whitespace-pre-wrap">{m.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
