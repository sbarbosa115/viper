import { Link } from 'react-router';
import { copy } from '../../copy';

/** The mobile "←" in the page header; the desktop breadcrumb is the shell's. */
export function BackLink() {
  return (
    <Link
      to="/support"
      aria-label={copy.backToTickets}
      className="-ml-2 grid size-11 place-items-center rounded-control text-xl text-fg hover:bg-surface md:hidden"
    >
      <span aria-hidden="true">←</span>
    </Link>
  );
}
