import { t } from '../i18n';
import { cx } from './cx';

export interface LogoProps {
  /** Show only the round Llyner icon (compact spots such as the mobile header). */
  markOnly?: boolean;
  /** Render the wordmark as a heading of this level (for sign-in pages). */
  headingLevel?: 1 | 2;
  className?: string;
}

/** The Llyner icon, dark-background version (docs/brand/llyner-icon-dark.svg). */
export function LlynerIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 150 150"
      aria-hidden="true"
      focusable="false"
      className={cx('size-8 shrink-0', className)}
    >
      <circle cx="75" cy="75" r="75" fill="#1877F2" />
      <circle cx="75" cy="75" r="64" fill="none" stroke="#FFFFFF" strokeWidth="4" />
      <path
        d="M35 81A12.5 12.5 0 0 1 60 81M89 81A12.5 12.5 0 0 1 114 81"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The LLYNER LEADS lockup, dark-background version (docs/brand/llyner-leads-dark.svg). */
export function LlynerWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="50 40 1360 300"
      aria-hidden="true"
      focusable="false"
      className={cx('h-[30px] w-auto shrink-0', className)}
    >
      <g fill="none" strokeLinecap="butt" strokeLinejoin="miter">
        <path
          d="M280.5 177V163.5A105 105 0 0 1 490.5 163.5V177"
          stroke="#4C9AFF"
          strokeWidth="16"
        />
        <path
          d="M331.5 152A17.5 17.5 0 0 1 366.5 152M404 152A17.5 17.5 0 0 1 439 152"
          stroke="#4C9AFF"
          strokeWidth="12"
        />
        <g stroke="#EDEDF2" strokeWidth="16">
          <path d="M62 194V327H131.5" />
          <path d="M183 194V327H252.5" />
          <path d="M285.5 194L328 276L371 194M328 276V331.5" />
          <path d="M414.5 331.5V194L484.5 331.5V194" />
          <path d="M613 198H543V327H612.5M543 258.5H601.5" />
          <path d="M662 331.5V198H704C722 198 730.5 211 730.5 230S722 262 704 262H662M701 262L732.5 331.5" />
        </g>
        <g stroke="#9A9AA8" strokeWidth="16">
          <path d="M840 194V327H909.5" />
          <path d="M1029 198H959V327H1028.5M959 258.5H1017.5" />
          <path d="M1078 331.5L1104 198H1124L1150 331.5M1088 280H1140" />
          <path d="M1200 198H1235C1262 198 1272 225 1272 262.5S1262 327 1235 327H1200Z" />
          <path d="M1390 212C1382 201 1370 198 1356 198C1336 198 1324 209 1324 227C1324 246 1340 252 1357 258C1376 265 1390 272 1390 293C1390 315 1374 327 1354 327C1338 327 1326 321 1320 310" />
        </g>
      </g>
    </svg>
  );
}

/** The LLYNER LEADS lockup; its accessible name is "Llyner Leads". */
export function Logo({ markOnly = false, headingLevel, className }: LogoProps) {
  if (markOnly) {
    return (
      <span className={cx('inline-flex items-center', className)}>
        <LlynerIcon />
        <span className="sr-only">{t('product.name')}</span>
      </span>
    );
  }
  const Word = headingLevel === 1 ? 'h1' : headingLevel === 2 ? 'h2' : 'span';
  return (
    <span className={cx('inline-flex items-center', className)}>
      <Word className="m-0 inline-flex items-center leading-none">
        <LlynerWordmark />
        <span className="sr-only">{t('product.name')}</span>
      </Word>
    </span>
  );
}
