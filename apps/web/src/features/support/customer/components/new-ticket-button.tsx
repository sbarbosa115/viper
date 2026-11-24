import { Link } from 'react-router';
import { Button, cx } from '../../../../shared/ui';
import { copy } from '../../copy';

export const primaryLink =
  'inline-flex h-11 items-center justify-center whitespace-nowrap rounded-control bg-accent px-[18px] text-[15px] font-semibold text-accent-ink hover:bg-accent-hover md:h-10 md:text-sm';

/** "New ticket", disabled with the reason while Staff are Acting as (FR-1). */
export function NewTicketButton({
  actingAs,
  className,
}: {
  actingAs: boolean;
  className?: string;
}) {
  if (actingAs) {
    return (
      <div className={cx('flex flex-col gap-1', className)}>
        <Button variant="primary" size="lg" disabled aria-describedby="acting-as-note">
          {copy.newTicket}
        </Button>
        <p id="acting-as-note" className="m-0 text-xs text-muted">
          {copy.actingAsNewTicket}
        </p>
      </div>
    );
  }
  return (
    <Link to="/support/new" className={cx(primaryLink, className)}>
      {copy.newTicket}
    </Link>
  );
}

/** "Open a new ticket", optionally prefilled through the query (category, runId). */
export function NewTicketLink({ search }: { search?: string }) {
  return (
    <Link
      to={search ? `/support/new?${search}` : '/support/new'}
      className="font-medium text-accent underline"
    >
      {copy.openNewTicket}
    </Link>
  );
}
