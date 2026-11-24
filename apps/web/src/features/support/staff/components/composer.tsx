import { useState, type KeyboardEvent } from 'react';
import { Banner, Button, Field, Tabs, Textarea } from '../../../../shared/ui';
import { copy } from '../copy';

export interface ComposerProps {
  customerName: string;
  closed: boolean;
  pending: boolean;
  /** Shown under the box; the text stays so the Staff Member can retry. */
  errorMessage: string | null;
  onReply: (
    message: string,
    then: 'wait_on_customer' | 'close' | undefined,
    done: () => void,
  ) => void;
  /** Close with an empty box. */
  onClose: () => void;
  onNote: (note: string, done: () => void) => void;
}

const isSend = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.key === 'Enter';

/** FR-9, FR-10: Reply to customer / Internal note. Drafts survive switching tabs. */
export function Composer(props: ComposerProps) {
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const text = reply.trim();
  const clear = () => setReply('');

  const replyPanel = (
    <div className="flex flex-col gap-3">
      <Field label={copy.replyField(props.customerName)}>
        {(p) => (
          <Textarea
            {...p}
            rows={5}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (isSend(e) && text && !props.pending) {
                e.preventDefault();
                props.onReply(text, undefined, clear);
              }
            }}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          disabled={props.closed || props.pending}
          onClick={() => (text ? props.onReply(text, 'close', clear) : props.onClose())}
        >
          {copy.closeTicket}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!text || props.pending}
            onClick={() => props.onReply(text, 'wait_on_customer', clear)}
          >
            {copy.replyAndWait}
          </Button>
          <Button
            variant="primary"
            hint="⌘↵"
            disabled={!text || props.pending}
            loading={props.pending}
            onClick={() => props.onReply(text, undefined, clear)}
          >
            {copy.reply}
          </Button>
        </div>
      </div>
    </div>
  );

  const notePanel = (
    <div className="flex flex-col gap-3">
      <Field label={copy.noteField} hint={copy.noteHint}>
        {(p) => (
          <Textarea
            {...p}
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (isSend(e) && note.trim() && !props.pending) {
                e.preventDefault();
                props.onNote(note.trim(), () => setNote(''));
              }
            }}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={!note.trim() || props.pending}
          onClick={() => props.onNote(note.trim(), () => setNote(''))}
        >
          {copy.addNote}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        label={copy.composerLabel}
        items={[
          { id: 'reply', label: copy.tabReply, panel: replyPanel },
          { id: 'note', label: copy.tabNote, panel: notePanel },
        ]}
      />
      {props.errorMessage && <Banner tone="warn">{props.errorMessage}</Banner>}
    </div>
  );
}
