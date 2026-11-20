import { useState } from 'react';
import { Field, Input } from '../../../../shared/ui';
import { copy } from '../copy';
import { TestButton } from './test-button';

/** FR-8: sends "Test email from Llyner Leads" to an address through the saved SMTP settings. */
export function SmtpTest() {
  const [to, setTo] = useState('');
  const [touched, setTouched] = useState(false);
  const invalid = touched && !/^\S+@\S+\.\S+$/.test(to.trim());
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
      <div className="min-w-64 flex-1">
        <Field
          label={copy.smtpTo}
          hint={copy.testHint}
          error={invalid ? 'Enter the address to send the test email to' : undefined}
        >
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="off"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onBlur={() => setTouched(true)}
            />
          )}
        </Field>
      </div>
      <TestButton
        target="smtp"
        label={copy.smtpTest}
        text={copy.smtpTest}
        to={to.trim()}
        disabled={to.trim() === '' || invalid}
      />
    </div>
  );
}
