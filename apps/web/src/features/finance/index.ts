import { createElement } from 'react';
import type { RouteObject } from 'react-router';
import { EmptyState } from '../../shared/ui';

/** Placeholder until the Expenses screens land (prd-expenses WP-3): P&L, Expenses, Provider invoices. */
export function ExpensesPlaceholderPage() {
  return createElement(
    'div',
    { className: 'mx-auto w-full max-w-3xl px-4 py-8 md:px-7' },
    createElement(
      'h1',
      { className: 'm-0 text-[26px] font-semibold tracking-tight text-fg' },
      'Expenses',
    ),
    createElement(EmptyState, {
      headingLevel: 3,
      title: 'Coming soon',
      description: 'The P&L, Expenses and Provider invoices tabs are on their way.',
    }),
  );
}

/** The finance feature's routes, mounted under /app by app/router.tsx (Staff shell). */
export const routes: RouteObject[] = [
  { path: 'staff/expenses', element: createElement(ExpensesPlaceholderPage) },
];
