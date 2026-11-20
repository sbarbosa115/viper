import type { Lead } from '@app/contracts/leads';
import { useState } from 'react';
import type { FeedbackActions } from '../api/use-feedback';
import { Banner, Button, Chip, Input, KeyboardHint } from '../../../shared/ui';
import { copy, notFitReasons } from '../copy';

function OtherReason({ lead, actions }: { lead: Lead; actions: FeedbackActions }) {
  const known = (notFitReasons as readonly string[]).includes(lead.feedbackReason ?? '');
  const [text, setText] = useState(known ? '' : (lead.feedbackReason ?? ''));
  const trimmed = text.trim();
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) actions.setReason(trimmed);
      }}
    >
      <Input
        aria-label={copy.otherReason}
        placeholder={copy.otherReason}
        maxLength={200}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Button type="submit" disabled={trimmed === '' || actions.pending}>
        {copy.saveReason}
      </Button>
    </form>
  );
}

/** "Good lead" / "Not a fit" (G and N), reasons for a miss, change or clear. */
export function FeedbackControls({ lead, actions }: { lead: Lead; actions: FeedbackActions }) {
  const good = lead.feedback === 'good';
  const notFit = lead.feedback === 'not_fit';
  return (
    <section aria-label={copy.yourFeedback} className="flex flex-col gap-3">
      <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        {copy.yourFeedback}
      </h2>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={good ? 'primary' : 'secondary'}
          aria-pressed={good}
          disabled={actions.pending}
          onClick={actions.good}
        >
          {copy.goodLead}
          <KeyboardHint>G</KeyboardHint>
        </Button>
        <Button
          variant={notFit ? 'primary' : 'secondary'}
          aria-pressed={notFit}
          disabled={actions.pending}
          onClick={actions.notFit}
        >
          {copy.notAFit}
          <KeyboardHint>N</KeyboardHint>
        </Button>
        {(good || notFit) && (
          <Button variant="ghost" disabled={actions.pending} onClick={actions.clear}>
            {copy.clearFeedback}
          </Button>
        )}
      </div>
      {notFit && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-muted">{copy.reasonsLabel}</span>
          <div className="flex flex-wrap gap-2">
            {notFitReasons.map((reason) => (
              <Chip
                key={reason}
                selected={lead.feedbackReason === reason}
                onSelectedChange={(selected) => actions.setReason(selected ? reason : undefined)}
                disabled={actions.pending}
              >
                {reason}
              </Chip>
            ))}
          </div>
          <OtherReason key={lead.feedbackReason ?? ''} lead={lead} actions={actions} />
        </div>
      )}
      <p className="m-0 text-[13px] text-muted" aria-live="polite">
        {good ? copy.markedGood : notFit ? copy.markedNotFit : copy.noFeedbackYet}
      </p>
      {actions.failed && <Banner tone="warn">{copy.feedbackFailed}</Banner>}
    </section>
  );
}
