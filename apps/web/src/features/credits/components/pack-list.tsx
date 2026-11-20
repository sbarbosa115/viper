import type { PackOffer } from '@app/contracts/billing';
import { Badge, Button, Card } from '../../../shared/ui';
import { copy, fill } from '../copy';
import { bonusPercent, formatCredits, formatUsd } from '../lib/format';

export interface PackListProps {
  packs: PackOffer[];
  /** Why buying is off right now; null when it is on. */
  disabledReason: string | null;
  pendingPackId: string | null;
  onBuy: (pack: PackOffer) => void;
}

export function PackList({ packs, disabledReason, pendingPackId, onBuy }: PackListProps) {
  if (packs.length === 0) return <p className="m-0 text-sm text-muted">{copy.noPacks}</p>;
  return (
    <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
      {packs.map((pack) => {
        const bonus = bonusPercent(pack.credits, pack.price.cents);
        return (
          <li key={pack.id}>
            <Card className="flex h-full flex-col gap-1">
              <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                {pack.name}
                {bonus > 0 && <Badge tone="accent">{fill(copy.bonus, { pct: bonus })}</Badge>}
              </span>
              <span className="font-mono text-2xl text-fg">{formatUsd(pack.price.cents)}</span>
              <span className="mb-3 text-sm text-muted">
                {formatCredits(pack.credits)} {copy.credits}
              </span>
              <Button
                variant="primary"
                className="mt-auto"
                aria-label={`${copy.buy} ${pack.name}`}
                disabled={disabledReason !== null}
                loading={pendingPackId === pack.id}
                onClick={() => onBuy(pack)}
              >
                {copy.buy}
              </Button>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
