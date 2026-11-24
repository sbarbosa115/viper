import {
  CATEGORIES,
  COVERS_PROVIDER_CATEGORIES,
  type Category,
  type Provider,
} from '@app/contracts/finance';
import type { ReactNode } from 'react';
import { t } from '../../../shared/i18n';
import { Field, Select } from '../../../shared/ui';

export const canCoverProvider = (category: Category | undefined): boolean =>
  category !== undefined && COVERS_PROVIDER_CATEGORIES.includes(category);

export interface ProviderOption extends Provider {
  category: Category;
}

/** "Covers usage of": the providers of the chosen category; only AI / Data providers bills. */
export function CoversField({
  providers,
  category,
  children,
  error,
}: {
  providers: ProviderOption[];
  category: Category;
  /** The registered select, rendered with the field's props. */
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    invalid: boolean;
    options: ReactNode;
  }) => ReactNode;
  error?: string | undefined;
}) {
  const options = (
    <>
      <option value="">{t('finance.form.coversNone')}</option>
      {providers
        .filter((p) => p.category === category)
        .map((p) => (
          <option key={p.key} value={p.key}>
            {p.name}
          </option>
        ))}
    </>
  );
  return (
    <Field label={t('finance.form.covers')} hint={t('finance.form.coversHint')} error={error}>
      {(p) => children({ ...p, options })}
    </Field>
  );
}

export const CategoryOptions = () => (
  <>
    {CATEGORIES.map((c) => (
      <option key={c.key} value={c.key}>
        {c.label}
      </option>
    ))}
  </>
);

export { Select };
