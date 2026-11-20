import { t } from '../i18n';
import { cx } from './cx';

export interface LogoProps {
  /** Hide the wordmark and show only the lime square mark. */
  markOnly?: boolean;
  /** Render the wordmark as a heading of this level (for sign-in pages). */
  headingLevel?: 1 | 2;
  className?: string;
}

/** Lime square L mark plus "Llyner Leads". */
export function Logo({ markOnly = false, headingLevel, className }: LogoProps) {
  const Word = headingLevel === 1 ? 'h1' : headingLevel === 2 ? 'h2' : 'span';
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-sm bg-accent font-sans text-[17px] font-bold leading-none text-accent-ink"
      >
        L
      </span>
      {markOnly ? (
        <span className="sr-only">{t('product.name')}</span>
      ) : (
        <Word className="m-0 text-[17px] font-semibold tracking-tight text-fg">
          {t('product.name')}
        </Word>
      )}
    </span>
  );
}
