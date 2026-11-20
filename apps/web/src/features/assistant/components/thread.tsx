import type { Message } from '@app/contracts/assistant';
import { Button, Chip, cx, Icon } from '../../../shared/ui';
import { copy } from '../copy';

function Bubble({ message }: { message: Pick<Message, 'role' | 'text'> }) {
  const mine = message.role === 'user';
  return (
    <div className={cx('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <span className="text-xs font-medium text-muted">{mine ? copy.you : copy.assistant}</span>
      <p
        className={cx(
          'm-0 max-w-[85%] whitespace-pre-wrap rounded-row px-4 py-2.5 text-[15px]',
          mine ? 'bg-raised text-fg' : 'border border-line-strong bg-surface text-fg-2',
        )}
      >
        {message.text}
      </p>
    </div>
  );
}

export interface ThreadProps {
  messages: Message[];
  /** A user message sent but not stored in the thread yet. */
  pendingText: string | null;
  typing: boolean;
  failed: boolean;
  limited: boolean;
  onQuickReply: (text: string) => void;
  onRetry: () => void;
}

export function Thread({
  messages,
  pendingText,
  typing,
  failed,
  limited,
  onQuickReply,
  onRetry,
}: ThreadProps) {
  const last = messages.at(-1);
  const quickReplies = !typing && !failed && last?.role === 'assistant' ? last.quickReplies : [];
  return (
    <div
      role="log"
      aria-live="polite"
      aria-label={copy.threadLabel}
      className="flex flex-1 flex-col gap-5 overflow-y-auto py-2"
    >
      {messages.map((m) => (
        <Bubble key={m.id} message={m} />
      ))}
      {pendingText && <Bubble message={{ role: 'user', text: pendingText }} />}
      {typing && (
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-muted">
          <span aria-hidden="true" className="viper-pulse">
            ●●●
          </span>
          {copy.typing}
        </p>
      )}
      {failed && (
        <p role="alert" className="m-0 flex items-center gap-2 text-sm text-danger">
          {copy.failed} ·
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <Icon name="retry" size={14} />
            {copy.retry}
          </Button>
        </p>
      )}
      {limited && (
        <p role="alert" className="m-0 text-sm text-danger">
          {copy.limit}
        </p>
      )}
      {quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested answers">
          {quickReplies.map((q) => (
            <Chip key={q} kind="choice" onSelectedChange={() => onQuickReply(q)}>
              {q}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
