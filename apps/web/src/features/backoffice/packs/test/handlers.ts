import {
  createCreditPack,
  creditPackInput,
  listCreditPacks,
  updateCreditPack,
  type CreditPack,
} from '@app/contracts/billing';
import { errorResponse } from '@app/contracts/errors';
import { creditPack as packExample } from '@app/contracts/examples';
import { http, HttpResponse } from 'msw';

const growth: CreditPack = {
  id: '0193a1b2-0000-7000-8000-0000000000b1',
  name: 'Growth',
  credits: 11000,
  priceCents: 10000,
  active: true,
};

export const packsState: { packs: CreditPack[]; requests: { method: string; body: unknown }[] } = {
  packs: [],
  requests: [],
};

export function resetPacksState() {
  packsState.packs = [packExample, growth];
  packsState.requests = [];
}
resetPacksState();

const invalid = (fields: Record<string, string>) =>
  HttpResponse.json(
    errorResponse.parse({ error: { code: 'VALIDATION_ERROR', message: 'Invalid', fields } }),
    { status: 400 },
  );

export const handlers = [
  http.get('*/api/staff/credit-packs', () =>
    HttpResponse.json(
      listCreditPacks.response.parse({ items: packsState.packs, nextCursor: null }),
    ),
  ),

  http.post('*/api/staff/credit-packs', async ({ request }) => {
    const body: unknown = await request.json();
    const parsed = creditPackInput.safeParse(body);
    if (!parsed.success) return invalid({ name: 'Invalid' });
    packsState.requests.push({ method: 'POST', body });
    const created = {
      id: `0193a1b2-0000-7000-8000-${String(packsState.packs.length + 100).padStart(12, '0')}`,
      ...parsed.data,
    };
    packsState.packs = [...packsState.packs, created];
    return HttpResponse.json(createCreditPack.response.parse(created), { status: 201 });
  }),

  http.put('*/api/staff/credit-packs/:id', async ({ params, request }) => {
    const body: unknown = await request.json();
    const parsed = creditPackInput.safeParse(body);
    if (!parsed.success) return invalid({ name: 'Invalid' });
    const id = String(params.id);
    if (!packsState.packs.some((p) => p.id === id)) {
      return HttpResponse.json(
        errorResponse.parse({ error: { code: 'NOT_FOUND', message: 'No pack' } }),
        { status: 404 },
      );
    }
    packsState.requests.push({ method: 'PUT', body });
    const updated = { id, ...parsed.data };
    packsState.packs = packsState.packs.map((p) => (p.id === id ? updated : p));
    return HttpResponse.json(updateCreditPack.response.parse(updated));
  }),
];
