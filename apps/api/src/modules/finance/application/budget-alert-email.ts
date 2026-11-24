import type { EmailMessage } from '../../../shared/application/email-sender.js';
import type { BudgetThreshold } from '../domain/budget.js';
import type { CalendarDay } from '../domain/calendar.js';

const PRODUCT = 'Llyner Leads';
/**
 * Midnight colours inlined for email clients, which ignore CSS variables (DESIGN.md: surface,
 * text, text-faint).
 */
const EMAIL_COLOURS = { button: '#13131A', buttonText: '#EDEDF2', muted: '#80808E' } as const;
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export interface BudgetAlertFacts {
  threshold: BudgetThreshold;
  /** `YYYY-MM`. */
  month: string;
  today: CalendarDay;
  spentCents: number;
  budgetCents: number;
  /** Whole percent of the Budget spent; null when the Budget is 0. */
  pct: number | null;
  topItems: readonly { name: string | null; categoryLabel: string; amountCents: number }[];
}

export function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

export function formatUsd(cents: number): string {
  const whole = Math.trunc(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${whole}.${(cents % 100).toString().padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const FOOTER =
  'You get this once per threshold (80% and 100%) each month because you are Staff on Llyner Leads.';

const itemLabel = (i: BudgetAlertFacts['topItems'][number]): string =>
  `${i.name ? `${i.name} (${i.categoryLabel})` : i.categoryLabel}: ${formatUsd(i.amountCents)}`;

/** FR-12: the budget alert for one Staff Member. */
export function budgetAlertEmail(p: {
  to: string;
  name: string;
  appUrl: string;
  facts: BudgetAlertFacts;
}): EmailMessage {
  const f = p.facts;
  const url = `${p.appUrl.replace(/\/+$/, '')}/app/staff/expenses`;
  const month = monthName(f.month);
  const pct = f.pct === null ? '' : ` (${f.pct}%)`;
  const summary = `As of ${f.today}, month-to-date spend is ${formatUsd(f.spentCents)} of the ${formatUsd(f.budgetCents)} budget${pct}.`;
  const items = f.topItems.map(itemLabel);
  const text = [
    `Hi ${p.name},`,
    '',
    summary,
    ...(items.length ? ['', 'The biggest items so far:', ...items.map((i) => `- ${i}`)] : []),
    '',
    `Open the P&L: ${url}`,
    '',
    FOOTER,
    '',
    `— ${PRODUCT}`,
    '',
  ].join('\n');
  const html = [
    `<p>Hi ${escapeHtml(p.name)},</p>`,
    `<p>${escapeHtml(summary)}</p>`,
    ...(items.length
      ? [
          '<p>The biggest items so far:</p>',
          `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`,
        ]
      : []),
    `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:${EMAIL_COLOURS.button};color:${EMAIL_COLOURS.buttonText};border-radius:8px;text-decoration:none">Open the P&amp;L</a></p>`,
    `<p style="color:${EMAIL_COLOURS.muted};font-size:13px">${FOOTER}</p>`,
    `<p>— ${PRODUCT}</p>`,
  ].join('\n');
  return {
    to: p.to,
    subject: `Spend passed ${f.threshold}% of the ${month} budget`,
    text,
    html,
  };
}
