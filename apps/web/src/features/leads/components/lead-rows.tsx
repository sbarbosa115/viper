import type { LeadSummary } from '@app/contracts/leads';
import { Badge, ListRow, ScoreBadge } from '../../../shared/ui';
import { copy } from '../copy';
import { contactSummary, formatMiles } from '../lib/format';

function FeedbackBadge({ value }: { value: LeadSummary['feedback'] }) {
  if (value === null) return null;
  return value === 'good' ? (
    <Badge tone="accent">{copy.goodLead}</Badge>
  ) : (
    <Badge>{copy.notAFit}</Badge>
  );
}

export interface LeadRowsProps {
  leads: LeadSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** One row per Lead: name, category, distance, contact kinds, Feedback state and Fit score. */
export function LeadRows({ leads, selectedId, onSelect }: LeadRowsProps) {
  return (
    <ul aria-label={copy.rowsLabel} className="m-0 flex list-none flex-col gap-0.5 p-2">
      {leads.map((lead) => {
        const meta = [
          lead.category,
          formatMiles(lead.distanceMiles),
          ...contactSummary(lead.contacts),
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <li key={lead.id} data-lead-id={lead.id}>
            <ListRow
              selected={lead.id === selectedId}
              onSelect={() => onSelect(lead.id)}
              title={lead.name}
              meta={meta}
              trailing={
                <span className="flex items-center gap-3">
                  <FeedbackBadge value={lead.feedback} />
                  <ScoreBadge score={lead.fitScore} />
                </span>
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
