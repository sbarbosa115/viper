import { grantCredits } from '@app/contracts/billing';
import { errorResponse } from '@app/contracts/errors';
import { customer as example, ids, ledgerEntry, me as meExample } from '@app/contracts/examples';
import { startActingAs } from '@app/contracts/identity';
import { listCustomers, updateCustomer, type Customer } from '@app/contracts/reporting';
import { http, HttpResponse } from 'msw';

const clean: Customer = {
  ...example,
  id: '0193a1b2-0000-7000-8000-0000000000d1',
  name: 'Clean Desk Co',
  ownerEmail: 'dana@cleandesk.example',
  verified: false,
  availableCredits: 0,
  runs: 0,
  leadsDelivered: 0,
  lastActiveAt: null,
};
const bakery: Customer = {
  ...example,
  id: '0193a1b2-0000-7000-8000-0000000000d2',
  name: 'Corner Bakery Supply',
  ownerEmail: 'jo@cornerbakery.example',
  signedUpAt: '2026-11-12T10:00:00.000Z',
  lastActiveAt: '2026-11-18T10:00:00.000Z',
  paying: true,
};

export const customersState: {
  customers: Customer[];
  queries: Record<string, string>[];
  actedAs: string[];
  patches: { id: string; internal: boolean }[];
  grants: { id: string; credits: number; reason: string }[];
  grantError: 'below-zero' | null;
} = { customers: [], queries: [], actedAs: [], patches: [], grants: [], grantError: null };

export function resetCustomersState() {
  customersState.customers = [example, clean, bakery];
  customersState.queries = [];
  customersState.actedAs = [];
  customersState.patches = [];
  customersState.grants = [];
  customersState.grantError = null;
}
resetCustomersState();

const sorters = {
  signedUp: (a: Customer, b: Customer) => b.signedUpAt.localeCompare(a.signedUpAt),
  lastActive: (a: Customer, b: Customer) =>
    (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''),
};

export const handlers = [
  http.get('*/api/staff/businesses', ({ request }) => {
    const raw = Object.fromEntries(new URL(request.url).searchParams);
    customersState.queries.push(raw);
    const query = listCustomers.query.parse(raw);
    const needle = query.q?.toLowerCase();
    const matching = customersState.customers
      .filter((c) => !needle || `${c.name} ${c.ownerEmail}`.toLowerCase().includes(needle))
      .sort(sorters[query.sort]);
    const start = Number(query.cursor ?? 0);
    const items = matching.slice(start, start + query.limit);
    const next = start + query.limit;
    return HttpResponse.json(
      listCustomers.response.parse({
        items,
        nextCursor: next < matching.length ? String(next) : null,
      }),
    );
  }),

  http.post('*/api/staff/acting-as', async ({ request }) => {
    const body = startActingAs.body.parse(await request.json());
    customersState.actedAs.push(body.businessId);
    const target = customersState.customers.find((c) => c.id === body.businessId);
    return HttpResponse.json(
      startActingAs.response.parse({
        ...meExample,
        member: { ...meExample.member, isStaff: true },
        actingAs: { businessId: body.businessId, businessName: target?.name ?? 'Unknown' },
      }),
    );
  }),

  http.patch('*/api/staff/businesses/:id', async ({ params, request }) => {
    const body = updateCustomer.body.parse(await request.json());
    const id = String(params.id);
    const found = customersState.customers.find((c) => c.id === id);
    if (!found) {
      return HttpResponse.json(
        errorResponse.parse({ error: { code: 'NOT_FOUND', message: 'No business' } }),
        { status: 404 },
      );
    }
    customersState.patches.push({ id, internal: body.internal });
    const updated = { ...found, internal: body.internal };
    customersState.customers = customersState.customers.map((c) => (c.id === id ? updated : c));
    return HttpResponse.json(updateCustomer.response.parse(updated));
  }),

  http.post('*/api/staff/businesses/:id/credits', async ({ params, request }) => {
    const parsed = grantCredits.body.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        errorResponse.parse({
          error: { code: 'VALIDATION_ERROR', message: 'Invalid', fields: { reason: 'Invalid' } },
        }),
        { status: 400 },
      );
    }
    if (customersState.grantError === 'below-zero') {
      return HttpResponse.json(
        errorResponse.parse({
          error: { code: 'INSUFFICIENT_CREDITS', message: 'Would go below 0' },
        }),
        { status: 422 },
      );
    }
    customersState.grants.push({ id: String(params.id), ...parsed.data });
    return HttpResponse.json(
      grantCredits.response.parse({ ...ledgerEntry, credits: parsed.data.credits }),
      { status: 201 },
    );
  }),
];

export const customerIds = { clean: clean.id, bakery: bakery.id, example: ids.business };
