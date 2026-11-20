import type { Lead } from '@app/contracts/leads';
import { Card } from '../../../shared/ui';
import { copy } from '../copy';

export function PitchCard({ pitch }: { pitch: Lead['pitch'] }) {
  return (
    <Card tone="accent" className="flex flex-col gap-1.5 !p-4">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        {copy.pitch}
      </h3>
      <p className="m-0 text-sm font-semibold text-fg">{pitch.productName}</p>
      <p className="m-0 text-sm text-fg-2">{pitch.reason}</p>
    </Card>
  );
}
