import type { LeadListStats } from '@app/contracts/leads';
import { StatTile } from '../../../shared/ui';
import { copy } from '../copy';

const oneDecimal = (n: number) => String(Number(n.toFixed(1)));

/** Leads, average Fit score, % verified contacts, credits, cost per lead. */
export function StatsStrip({ stats }: { stats: LeadListStats }) {
  return (
    <div
      role="group"
      aria-label="Lead list statistics"
      className="grid grid-cols-2 border-b border-line md:grid-cols-5"
    >
      <StatTile label={copy.statLeads} value={stats.total} />
      <StatTile
        label={copy.statAvgFit}
        value={stats.avgFitScore === null ? null : Math.round(stats.avgFitScore)}
      />
      <StatTile
        label={copy.statVerified}
        value={stats.verifiedPct === null ? null : `${Math.round(stats.verifiedPct)}%`}
      />
      <StatTile label={copy.statCredits} value={stats.creditsSpent} />
      <StatTile
        label={copy.statCostPerLead}
        value={stats.costPerLead === null ? null : oneDecimal(stats.costPerLead)}
        highlight
      />
    </div>
  );
}
