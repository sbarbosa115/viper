import { http, HttpResponse } from 'msw';
import { handlers as customerHandlers } from './customer-handlers';

/**
 * Global MSW handlers for the support feature (loaded by test/setup.ts): the customer endpoints,
 * plus the Staff waiting count the back-office nav badge reads. The Staff desk tests add
 * `staffHandlers` from ./staff-handlers themselves.
 */
export const handlers = [
  ...customerHandlers,
  http.get('*/api/staff/support/count', () => HttpResponse.json({ waiting: 0 })),
];
