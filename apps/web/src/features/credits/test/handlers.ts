import { creditWallet, ledgerEntry, type CreditWallet, type LedgerEntry } from '@app/contracts/billing';
import { page } from '@app/contracts/common';
import { errorResponse } from '@app/contracts/errors';
import { creditWallet as walletExample, ids, ledgerEntry as ledgerExample } from '@app/contracts/examples';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';

export const ledgerPage = page(ledgerEntry);

/** Tweak per test; `resetCreditsState()` restores the defaults. */
export const creditsState: {
  wallet: CreditWallet;
  ledger: LedgerEntry[];
  checkout: { status: 200 | 403 | 404 | 503; code?: string };
} = { wallet: walletExample, ledger: [], checkout: { status: 200 } };

export function resetCreditsState() {
  creditsState.wallet = {
    ...walletExample,
    packs: [
      ...walletExample.packs,
      { id: ids.ledger, name: 'Growth', credits: 11000, price: { cents: 10000, currency: 'usd' } },
    ],
  };
  creditsState.ledger = [ledgerExample];
  creditsState.checkout = { status: 200 };
}
resetCreditsState();

const checkoutBody = z.object({ packId: z.uuid() });

export const handlers = [
  http.get('*/api/credits', () => HttpResponse.json(creditWallet.parse(creditsState.wallet))),

  http.get('*/api/credits/ledger', ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const start = Number(url.searchParams.get('cursor') ?? 0);
    const items = creditsState.ledger.slice(start, start + limit);
    const end = start + limit;
    return HttpResponse.json(
      ledgerPage.parse({ items, nextCursor: end < creditsState.ledger.length ? String(end) : null }),
    );
  }),

  http.post('*/api/credits/checkout', async ({ request }) => {
    const parsed = checkoutBody.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        errorResponse.parse({ error: { code: 'VALIDATION_ERROR', message: 'Invalid' } }),
        { status: 400 },
      );
    }
    const { status, code } = creditsState.checkout;
    if (status !== 200) {
      return HttpResponse.json(
        errorResponse.parse({ error: { code: code ?? 'NOT_FOUND', message: 'No' } }),
        { status },
      );
    }
    return HttpResponse.json({ checkoutUrl: 'https://checkout.stripe.test/session/abc' });
  }),
];
