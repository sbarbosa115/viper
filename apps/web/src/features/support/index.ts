import { createElement } from 'react';

/**
 * The support feature (prd-support): customer Help pages under /app/support and the Staff Support
 * desk under /app/staff/support. WP-0 placeholders; `customer/` and `staff/` replace them in Wave 1
 * along with this feature's `routes`.
 */

function placeholder(title: string, displayName: string) {
  const Page = () => createElement('h1', { className: 'text-2xl font-semibold text-fg' }, title);
  Page.displayName = displayName;
  return Page;
}

/** `/app/support`: Your tickets (FR-1). */
export const SupportListPage = placeholder('Help', 'SupportListPage');
/** `/app/support/new`: open a ticket (FR-2). */
export const NewTicketPage = placeholder('New ticket', 'NewTicketPage');
/** `/app/support/:number`: the customer thread (FR-4). */
export const TicketPage = placeholder('Ticket', 'TicketPage');
/** `/app/staff/support`: the Support desk (FR-6). */
export const StaffSupportDeskPage = placeholder('Support', 'StaffSupportDeskPage');
/** `/app/staff/support/:number`: the Staff ticket view (FR-7). */
export const StaffTicketPage = placeholder('Ticket', 'StaffTicketPage');

/** What the nav badge reads; the real hook returns a TanStack Query result of this shape. */
export interface SupportWaitingCount {
  /** Tickets in the Waiting queue; undefined while loading. */
  data: number | undefined;
}

/**
 * The Staff nav badge (FR-6): `GET /api/staff/support/count` → `waiting`, with
 * `refetchInterval: 60_000` and refetch on window focus; enabled only for Staff (`enabled`).
 * Hidden at 0. WP-0 stub: always 0 until the staff feature implements it.
 */
export function useSupportWaitingCount(_options: { enabled?: boolean } = {}): SupportWaitingCount {
  return { data: 0 };
}
