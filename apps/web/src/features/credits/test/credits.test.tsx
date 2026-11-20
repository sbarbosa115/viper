import { ledgerEntry as ledgerExample, me as meExample } from '@app/contracts/examples';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { server } from '../../../test/setup';
import { redirectTo } from '../lib/redirect';
import { creditsState, resetCreditsState } from './handlers';
import { meHandler, renderCredits, renderCreditsPage } from './render';

const signIn = (...args: Parameters<typeof meHandler>) => server.use(meHandler(...args));

vi.mock('../lib/redirect', () => ({ redirectTo: vi.fn() }));

beforeEach(() => {
  sessionStorage.clear();
  resetCreditsState();
  signIn();
  vi.mocked(redirectTo).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('FR-10: credit wallet page', () => {
  test('shows available and reserved credits, the packs and the policy note', async () => {
    renderCredits();
    expect(await screen.findByRole('heading', { level: 1, name: 'Credits' })).toBeInTheDocument();
    expect(await screen.findByText('600')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Reserved for running research')).toBeInTheDocument();
    expect(screen.getByText(/Credits never expire and are not refundable/)).toBeInTheDocument();
    expect(screen.getByText('$25')).toBeInTheDocument();
    expect(screen.getByText('2,500 credits')).toBeInTheDocument();
    expect(screen.getByText('10% bonus')).toBeInTheDocument();
  });

  test('the history lists entries newest first with signed credits', async () => {
    creditsState.ledger = [
      { ...ledgerExample, id: '0193a1b2-0000-7000-8000-0000000000a1', credits: -137 },
      {
        ...ledgerExample,
        id: '0193a1b2-0000-7000-8000-0000000000a2',
        type: 'grant',
        credits: 50,
        description: 'Free trial credits',
      },
    ];
    renderCredits();
    const table = await screen.findByRole('table', { name: 'Credit history' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('−137')).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Run · Bakeries near Austin/)).toBeInTheDocument();
    expect(within(rows[2]!).getByText('+50')).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/Free trial credits/)).toBeInTheDocument();
  });

  test('25 per page: "Show more" loads the next page', async () => {
    creditsState.ledger = Array.from({ length: 30 }, (_, i) => ({
      ...ledgerExample,
      id: `0193a1b2-0000-7000-8000-${String(i + 100).padStart(12, '0')}`,
      description: `Entry ${i + 1}`,
    }));
    renderCredits();
    const table = await screen.findByRole('table', { name: 'Credit history' });
    expect(within(table).getAllByRole('row')).toHaveLength(26);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(31));
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  test('an empty ledger shows an empty state', async () => {
    creditsState.ledger = [];
    renderCredits();
    expect(await screen.findByText('No credit activity yet')).toBeInTheDocument();
  });

  test('a failed wallet load shows an error with Try again', async () => {
    server.use(http.get('*/api/credits', () => new HttpResponse(null, { status: 500 })));
    renderCredits();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    server.resetHandlers();
    signIn();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('600')).toBeInTheDocument();
  });

  test('a failed history load shows an error while the wallet still shows', async () => {
    server.use(http.get('*/api/credits/ledger', () => new HttpResponse(null, { status: 500 })));
    renderCredits();
    expect(await screen.findByText('600')).toBeInTheDocument();
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });
});

describe('FR-12: buy credit packs', () => {
  test('Buy redirects to Stripe Checkout', async () => {
    renderCredits();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Buy Starter' }));
    await waitFor(() =>
      expect(redirectTo).toHaveBeenCalledWith('https://checkout.stripe.test/session/abc'),
    );
  });

  test('payments not set up: buttons are disabled with the message', async () => {
    creditsState.wallet = { ...creditsState.wallet, paymentsAvailable: false };
    renderCredits();
    expect(await screen.findByText("Payments aren't set up yet")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy Starter' })).toBeDisabled();
  });

  test('a 503 on checkout shows the payments message', async () => {
    creditsState.checkout = { status: 503, code: 'PAYMENTS_UNAVAILABLE' };
    renderCredits();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Buy Starter' }));
    expect(await screen.findByText("Payments aren't set up yet")).toBeInTheDocument();
    expect(redirectTo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Buy Starter' })).toBeEnabled();
  });

  test('an inactive pack (404) says so and refreshes the list', async () => {
    creditsState.checkout = { status: 404, code: 'NOT_FOUND' };
    renderCredits();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Buy Starter' }));
    expect(await screen.findByText(/no longer available/)).toBeInTheDocument();
  });

  test('an unverified Member cannot buy', async () => {
    signIn({ ...meExample, member: { ...meExample.member, emailVerified: false } });
    renderCredits();
    expect(await screen.findByText('Verify your email to buy credits.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy Starter' })).toBeDisabled();
  });

  test('while Acting as, Buy is hidden and a note explains', async () => {
    signIn({
      ...meExample,
      actingAs: { businessId: meExample.business.id, businessName: 'Acme Bakery' },
    });
    renderCredits();
    expect(await screen.findByText(/You are acting as Acme Bakery/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Buy/ })).not.toBeInTheDocument();
  });
});

describe('FR-12: returning from Stripe', () => {
  const walletCalls = () => {
    let calls = 0;
    server.use(
      http.get('*/api/credits', () => {
        calls += 1;
        return HttpResponse.json(creditsState.wallet);
      }),
    );
    return () => calls;
  };

  async function settle() {
    for (let i = 0; i < 5; i += 1) await vi.advanceTimersByTimeAsync(20);
  }

  test('shows "Payment received, adding your credits…" and refreshes every 3 s for up to 60 s', async () => {
    const calls = walletCalls();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    renderCreditsPage('/credits?purchase=success');
    await settle();
    expect(screen.getByText('Payment received, adding your credits…')).toBeInTheDocument();
    expect(calls()).toBe(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(6000);
    expect(calls()).toBe(4);

    await vi.advanceTimersByTimeAsync(60_000);
    const total = calls();
    expect(total).toBeLessThanOrEqual(21);
    expect(screen.getByText(/taking longer than usual/)).toBeInTheDocument();
    expect(screen.queryByText('Payment received, adding your credits…')).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls()).toBe(total);
  });

  test('stops and confirms once the balance goes up', async () => {
    const calls = walletCalls();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    renderCreditsPage('/credits?purchase=success');
    await settle();
    expect(screen.getByText('600')).toBeInTheDocument();

    creditsState.wallet = { ...creditsState.wallet, balance: 3500, available: 3100 };
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(screen.getByText('Your credits were added.')).toBeInTheDocument();
    expect(screen.getByText('3,100')).toBeInTheDocument();
    const after = calls();
    await vi.advanceTimersByTimeAsync(9000);
    expect(calls()).toBe(after);
  });

  test('the webhook landing before the return still confirms (baseline from before checkout)', async () => {
    renderCredits();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Buy Starter' }));
    await waitFor(() => expect(redirectTo).toHaveBeenCalled());
    expect(sessionStorage.getItem('viper.credits.purchaseBaseline')).toBe(
      String(creditsState.wallet.balance),
    );

    // The webhook credits the wallet before the Member comes back from checkout.
    creditsState.wallet = { ...creditsState.wallet, balance: 3500, available: 3100 };
    cleanup();
    renderCreditsPage('/credits?purchase=success');
    expect(await screen.findByText('Your credits were added.')).toBeInTheDocument();
    expect(sessionStorage.getItem('viper.credits.purchaseBaseline')).toBeNull();
  });

  test('without ?purchase=success nothing polls and no banner shows', async () => {
    const calls = walletCalls();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    renderCreditsPage('/credits');
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls()).toBe(1);
    expect(screen.queryByText('Payment received, adding your credits…')).not.toBeInTheDocument();
  });
});
