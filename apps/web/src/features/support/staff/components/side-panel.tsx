import type { StaffTicketDetail } from '@app/contracts/support';
import { Link } from 'react-router';
import { Button, Card } from '../../../../shared/ui';
import { copy } from '../copy';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-2 text-sm last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 text-right text-fg-2">{value}</dd>
    </div>
  );
}

export interface SidePanelProps {
  ticket: StaffTicketDetail;
  opening: boolean;
  openFailed: boolean;
  onOpenAs: () => void;
}

/** FR-7: who the customer is, the Business's state, Open as this Business and the linked run. */
export function SidePanel({ ticket, opening, openFailed, onOpenAs }: SidePanelProps) {
  const { context, run } = ticket;
  const credits = (n: number) => `${n.toLocaleString('en-US')} cr`;
  return (
    <aside aria-label={copy.customerHeading} className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <h2 className="m-0 font-mono text-xs font-semibold tracking-wider text-muted">
          {copy.customerHeading}
        </h2>
        <dl className="m-0">
          <Row label={copy.business} value={ticket.business.name} />
          <Row
            label={copy.from}
            value={`${ticket.openedBy.name} · ${context.openedByRole === 'owner' ? copy.owner : copy.member}`}
          />
          <Row label={copy.balance} value={credits(context.balanceNow)} />
          {context.balanceAtOpen !== null && context.balanceAtOpen !== context.balanceNow && (
            <Row label={copy.balanceAtOpen} value={credits(context.balanceAtOpen)} />
          )}
          {context.pagePath && <Row label={copy.page} value={context.pagePath} />}
          <Row label={copy.openTickets} value={String(context.businessOpenTickets)} />
        </dl>
        <Button variant="primary" loading={opening} onClick={onOpenAs}>
          {copy.openAs}
        </Button>
        <p className="m-0 text-xs text-faint">{copy.openAsHint(ticket.number)}</p>
        {openFailed && (
          <p role="alert" className="m-0 text-xs text-danger">
            {copy.openAsFailed}
          </p>
        )}
      </Card>
      {run && (
        <Card className="flex flex-col gap-1.5">
          <h2 className="m-0 font-mono text-xs font-semibold tracking-wider text-muted">
            {copy.linkedRun}
          </h2>
          <p className="m-0 font-medium text-fg">{run.planName}</p>
          <p className="m-0 text-[13px] text-muted">
            {[
              copy.attempt(run.attempt),
              run.stoppedStep && copy.stoppedAt(run.stoppedStep.number, run.stoppedStep.name),
              run.lastError && copy.lastError(run.lastError),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="m-0 font-mono text-xs text-fg-2">
            {run.status.toUpperCase()} · {copy.chargedCr(run.creditsCharged)} ·{' '}
            <Link to={`/staff/runs/${run.id}`} className="text-accent">
              {copy.openInRuns} ›
            </Link>
          </p>
        </Card>
      )}
    </aside>
  );
}
