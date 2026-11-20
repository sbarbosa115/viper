import type { Secret } from '@app/contracts/platform';
import { useState } from 'react';
import { Button, Input } from '../../../../shared/ui';
import { copy } from '../copy';
import type { FieldDef } from '../lib/fields';
import { formatDay } from '../lib/format';
import { TestButton } from './test-button';

export interface SecretFieldProps {
  def: FieldDef;
  /** As GET returned it: never the value, only whether it is set and its last 4. */
  secret: Secret;
  /** undefined keeps, a string replaces, "" clears. */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  error?: string | undefined;
}

type Mode = 'idle' | 'replace' | 'clear';

function status(secret: Secret): string {
  if (!secret.set) return copy.notSet;
  const parts: string[] = [copy.set];
  if (secret.last4) parts.push(`••••${secret.last4}`);
  if (secret.updatedAt) parts.push(`${copy.updated} ${formatDay(secret.updatedAt)}`);
  return parts.join(' · ');
}

/** A write-only secret: its status, Replace / Remove, and the Test action (FR-8, ADR 0012). */
export function SecretField({ def, secret, value, onChange, error }: SecretFieldProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const labelId = `secret-${def.path}`;
  const go = (next: Mode, v: string | undefined) => {
    setMode(next);
    onChange(v);
  };
  const action = secret.set ? copy.replace : copy.addKey;
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span id={labelId} className="min-w-40 text-[13px] font-medium text-fg">
          {def.label}
        </span>
        <span className={secret.set ? 'text-sm text-fg-2' : 'text-sm text-faint'}>
          <span aria-hidden="true" className={secret.set ? 'text-accent' : ''}>
            {secret.set ? '● ' : '○ '}
          </span>
          {status(secret)}
        </span>
        {mode === 'idle' && (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${action} ${def.label}`}
              onClick={() => go('replace', undefined)}
            >
              {action}
            </Button>
            {secret.set && (
              <Button
                size="sm"
                variant="danger-text"
                aria-label={`${copy.remove} ${def.label}`}
                onClick={() => go('clear', '')}
              >
                {copy.remove}
              </Button>
            )}
            {def.testTarget && secret.set && (
              <TestButton target={def.testTarget} label={`${copy.test} ${def.label}`} />
            )}
          </>
        )}
      </div>
      {mode === 'clear' && (
        <p className="m-0 flex items-center gap-2 text-sm text-warn">
          {copy.willClear}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${copy.cancel} ${def.label}`}
            onClick={() => go('idle', undefined)}
          >
            {copy.cancel}
          </Button>
        </p>
      )}
      {mode === 'replace' && (
        <div className="flex items-center gap-2">
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${def.label} ${copy.newValue}`}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            className="max-w-sm"
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${copy.cancel} ${def.label}`}
            onClick={() => go('idle', undefined)}
          >
            {copy.cancel}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
