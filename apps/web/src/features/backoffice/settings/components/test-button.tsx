import { useState } from 'react';
import { Button } from '../../../../shared/ui';
import { useTestSetting } from '../api/hooks';
import { copy } from '../copy';

export interface TestButtonProps {
  target: string;
  /** Accessible name, e.g. "Test Apify". */
  label: string;
  text?: string;
  to?: string;
  disabled?: boolean;
}

/** FR-8 "Test": runs the check on the saved settings and shows the result inline. */
export function TestButton({ target, label, text = copy.test, to, disabled }: TestButtonProps) {
  const test = useTestSetting();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const run = () => {
    setResult(null);
    test.mutate(to === undefined ? { target } : { target, to }, {
      onSuccess: setResult,
      onError: (error) =>
        setResult({
          ok: false,
          message: error instanceof Error && error.message ? error.message : copy.testFailedToRun,
        }),
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        aria-label={label}
        loading={test.isPending}
        disabled={disabled}
        onClick={run}
      >
        {test.isPending ? copy.testing : text}
      </Button>
      {result && (
        <span role="status" className={result.ok ? 'text-sm text-accent' : 'text-sm text-danger'}>
          {result.ok ? '● ' : '○ '}
          {result.message}
        </span>
      )}
    </span>
  );
}
