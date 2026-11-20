import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Input } from '../../../shared/ui';
import { copy, fill } from '../copy';

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
}

const LENGTH = 6;

/** Six single-digit boxes in one fieldset; typing advances, backspace retreats, paste fills. */
export function CodeInput({ value, onChange, invalid, describedBy, disabled }: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');

  const focus = (index: number) => refs.current[Math.min(Math.max(index, 0), LENGTH - 1)]?.focus();

  const setDigit = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');
    if (!typed) {
      onChange(digits.map((d, i) => (i === index ? '' : d)).join(''));
      return;
    }
    const next = digits.slice();
    typed
      .slice(0, LENGTH - index)
      .split('')
      .forEach((d, i) => (next[index + i] = d));
    onChange(next.join(''));
    focus(index + typed.length);
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index]) focus(index - 1);
    if (event.key === 'ArrowLeft') focus(index - 1);
    if (event.key === 'ArrowRight') focus(index + 1);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    focus(pasted.length);
  };

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" aria-describedby={describedBy}>
      <legend className="mb-1.5 p-0 text-[13px] font-medium text-fg">{copy.twoFactor.legend}</legend>
      <div className="flex gap-2">
        {digits.map((digit, index) => (
          <Input
            key={index}
            ref={(el) => {
              refs.current[index] = el;
            }}
            aria-label={fill(copy.twoFactor.digit, { n: index + 1 })}
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={LENGTH}
            value={digit}
            invalid={invalid}
            disabled={disabled}
            onChange={(e) => setDigit(index, e.target.value)}
            onKeyDown={(e) => onKeyDown(index, e)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
            className="text-center font-mono text-lg"
          />
        ))}
      </div>
    </fieldset>
  );
}
