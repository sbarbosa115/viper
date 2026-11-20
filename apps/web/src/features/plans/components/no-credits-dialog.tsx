import { Button, Dialog } from '../../../shared/ui';
import { copy, fill } from '../copy';

export interface NoCreditsDialogProps {
  shortfall: { available: number; required: number };
  busy: boolean;
  onLower: () => void;
  onBuy: () => void;
  onClose: () => void;
}

/** FR-18 / AJ-4: not enough credits. */
export function NoCreditsDialog({
  shortfall,
  busy,
  onLower,
  onBuy,
  onClose,
}: NoCreditsDialogProps) {
  const canLower = shortfall.available >= 10;
  return (
    <Dialog
      open
      onClose={onClose}
      title={fill(copy.needTitle, shortfall)}
      footer={
        <>
          <Button onClick={onClose}>{copy.cancel}</Button>
          <Button variant={canLower ? 'secondary' : 'primary'} onClick={onBuy}>
            {copy.buyCredits}
          </Button>
          {canLower && (
            <Button variant="primary" loading={busy} onClick={onLower}>
              {fill(copy.lowerBudget, { n: shortfall.available })}
            </Button>
          )}
        </>
      }
    >
      <p className="m-0">{copy.needBody}</p>
    </Dialog>
  );
}
