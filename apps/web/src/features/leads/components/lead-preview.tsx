import type { Lead } from '@app/contracts/leads';
import { Link } from 'react-router';
import type { FeedbackActions } from '../api/use-feedback';
import { IconButton, ScoreBadge } from '../../../shared/ui';
import { copy } from '../copy';
import { formatMiles } from '../lib/format';
import { ContactList } from './contacts';
import { EvidenceList } from './evidence';
import { FeedbackControls } from './feedback-controls';
import { PitchCard } from './pitch-card';

const sectionTitle = 'm-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted';

/** The preview pane (and the phone's own view): why this Lead fits, and what to do about it. */
export function LeadPreview({
  lead,
  actions,
  onClose,
}: {
  lead: Lead;
  actions: FeedbackActions;
  onClose: () => void;
}) {
  const meta = [lead.category, formatMiles(lead.distanceMiles), lead.address].filter(Boolean);
  return (
    <article className="flex flex-col gap-5 p-5">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-lg font-semibold text-fg">{lead.name}</h2>
          {meta.length > 0 && <p className="m-0 text-[13px] text-muted">{meta.join(' · ')}</p>}
        </div>
        <ScoreBadge score={lead.fitScore} />
        <IconButton aria-label={copy.closePreview} icon="x" onClick={onClose} />
      </header>
      {lead.contacts.length > 0 && <ContactList contacts={lead.contacts} />}
      <section className="flex flex-col gap-1">
        <h3 className={sectionTitle}>{copy.evidence}</h3>
        <EvidenceList evidence={lead.evidence} />
      </section>
      <PitchCard pitch={lead.pitch} />
      <FeedbackControls lead={lead} actions={actions} />
      <Link to={`/leads/${lead.id}`} className="text-sm text-accent hover:underline">
        {copy.openFull} →
      </Link>
    </article>
  );
}
