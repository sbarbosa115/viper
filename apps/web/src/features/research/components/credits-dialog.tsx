import { Button, Dialog } from '../../../shared/ui';
import { copy, fill } from '../copy';

export interface CreditsDialogProps {
  shortfall: { available: number; required: number } | null;
  onBuy: () => void;
  onClose: () => void;
}

/** "Try again" without enough credits. Unlike a new run there is no lower budget to offer. */
export function CreditsDialog({ shortfall, onBuy, onClose }: CreditsDialogProps) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={shortfall ? fill(copy.needTitle, shortfall) : copy.needTitleUnknown}
      footer={
        <>
          <Button onClick={onClose}>{copy.cancel}</Button>
          <Button variant="primary" onClick={onBuy}>
            {copy.buyCredits}
          </Button>
        </>
      }
    >
      <p className="m-0">{copy.needBody}</p>
    </Dialog>
  );
}
