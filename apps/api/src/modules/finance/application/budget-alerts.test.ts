import { describe, expect, test } from 'vitest';
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { assembleFinance } from '../index.js';
import { oneOff } from '../test/factories.js';
import { fakeWorld, STAFF_EMAIL } from '../test/fakes.js';

function setup(spendCents: number, budgetCents = 30000) {
  const world = fakeWorld();
  const email = new InMemoryEmailSender();
  const warnings: unknown[] = [];
  world.store.settings = { ...world.store.settings, monthlyBudgetCents: budgetCents };
  world.store.add(oneOff('Legal review', 'legal_admin', spendCents, '2026-11-10'));
  const finance = assembleFinance(world.ctx, {
    email,
    appUrl: 'http://localhost:5173/',
    logger: { info: () => undefined, warn: (o) => warnings.push(o) },
  });
  const spend = (cents: number) =>
    world.store.add(oneOff(`Extra ${cents}`, 'hosting', cents, '2026-11-12'));
  return { world, email, warnings, check: finance.budgetCheck, spend };
}

describe('FR-12: budget alerts', () => {
  test('AC: $250 of a $300 budget sends the 80% email to every Staff Member, once a day', async () => {
    const { world, email, check } = setup(25000);
    world.staff.staff.push({ memberId: 'm2', email: 'second@demo.test', name: 'Sue Staff' });
    expect(await check.execute()).toEqual([80]);
    expect(email.sent.map((m) => m.to)).toEqual([STAFF_EMAIL, 'second@demo.test']);
    expect(email.sent[0]?.subject).toBe('Spend passed 80% of the November budget');
    expect(world.store.alerts.get('2026-11')).toEqual([80]);

    expect(await check.execute()).toEqual([]);
    expect(email.sent).toHaveLength(2);
  });

  test('AC: jumping from $200 to $401.37 sends only the 100% email and records both', async () => {
    const { world, email, check, spend } = setup(20000);
    expect(await check.execute()).toEqual([]);
    expect(email.sent).toEqual([]);
    spend(20137);
    expect(await check.execute()).toEqual([100]);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.subject).toBe('Spend passed 100% of the November budget');
    expect(world.store.alerts.get('2026-11')).toEqual([80, 100]);
    expect(await check.execute()).toEqual([]);
  });

  test('AC: $100 of $300 sends nothing and records nothing', async () => {
    const { world, email, check } = setup(10000);
    expect(await check.execute()).toEqual([]);
    expect(email.sent).toEqual([]);
    expect(world.store.alerts.size).toBe(0);
  });

  test('80% then 100% on a later check sends each once', async () => {
    const { email, check, spend } = setup(25000);
    expect(await check.execute()).toEqual([80]);
    spend(6000);
    expect(await check.execute()).toEqual([100]);
    expect(email.sent.map((m) => m.subject)).toEqual([
      'Spend passed 80% of the November budget',
      'Spend passed 100% of the November budget',
    ]);
  });

  test('raising the Budget later does not re-send an alerted threshold', async () => {
    const { world, email, check } = setup(25000);
    await check.execute();
    world.store.settings = { ...world.store.settings, monthlyBudgetCents: 31000 };
    expect(await check.execute()).toEqual([]);
    expect(email.sent).toHaveLength(1);
  });

  test('the email has the figures, the biggest items, the button and the footer', async () => {
    const { email, check, spend } = setup(25000);
    spend(1234);
    await check.execute();
    const m = email.sent[0]!;
    expect(m.text).toContain(
      'As of 2026-11-20, month-to-date spend is $262.34 of the $300.00 budget (87%).',
    );
    expect(m.text).toContain('- Legal review (Legal & admin): $250.00');
    expect(m.text).toContain('Open the P&L: http://localhost:5173/app/staff/expenses');
    expect(m.text).toContain(
      'You get this once per threshold (80% and 100%) each month because you are Staff on Llyner Leads.',
    );
    expect(m.html).toContain('href="http://localhost:5173/app/staff/expenses"');
    expect(m.html).toContain('Open the P&amp;L</a>');
  });

  test('analytics: budget_alert_sent carries the figures and the recipient count, no personal data', async () => {
    const { world, check } = setup(25000);
    await check.execute();
    expect(world.analytics.events).toEqual([
      {
        name: 'budget_alert_sent',
        properties: {
          month: '2026-11',
          threshold: 80,
          spent_cents: 25000,
          budget_cents: 30000,
          recipients_count: 1,
        },
      },
    ]);
  });

  test('no Staff Members: nothing is sent, it is logged, and the alert stays recorded', async () => {
    const { world, email, warnings, check } = setup(25000);
    world.staff.staff.length = 0;
    expect(await check.execute()).toEqual([]);
    expect(email.sent).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(world.store.alerts.get('2026-11')).toEqual([80]);
  });

  test('SMTP down: the alert stays recorded, the next check does not send it again', async () => {
    const { world, check } = setup(25000);
    const down = { send: () => Promise.reject(new Error('smtp down')) };
    const failing = assembleFinance(world.ctx, {
      email: down,
      appUrl: 'http://localhost:5173',
      logger: { info: () => undefined, warn: () => undefined },
    });
    await failing.budgetCheck.execute();
    expect(world.store.alerts.get('2026-11')).toEqual([80]);
    expect(await check.execute()).toEqual([]);
  });
});
