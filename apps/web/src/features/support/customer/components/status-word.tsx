import { statusLabels, type Status } from '@app/contracts/support';
import { cx } from '../../../../shared/ui';

const tone: Record<Status, string> = {
  open: 'text-fg-2',
  in_progress: 'text-accent',
  waiting_on_customer: 'text-warn',
  closed: 'text-muted',
};

/** A status is always a word (never colour alone): "WE'RE ON IT", "WAITING ON YOU". */
export function StatusWord({
  status,
  pill = false,
  className,
}: {
  status: Status;
  pill?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'font-mono text-xs font-medium uppercase tracking-wider',
        tone[status],
        pill && 'rounded-full bg-raised px-2.5 py-1',
        pill && status === 'in_progress' && 'bg-accent-tint',
        className,
      )}
    >
      {statusLabels[status]}
    </span>
  );
}
