import { auditLogEntry as entryExample, ids } from '@app/contracts/examples';
import type { AuditLogEntry } from '@app/contracts/platform';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../../test/setup';
import { auditState, handlers, resetAuditState } from './handlers';
import { renderAudit } from './render';

const other = {
  staff: '0193a1b2-0000-7000-8000-0000000000c1',
  business: '0193a1b2-0000-7000-8000-0000000000c2',
};

const entry = (n: number, over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  ...entryExample,
  id: `0193a1b2-0000-7000-8000-${String(n).padStart(12, '0')}`,
  at: `2026-11-19T${String(10 + (n % 10)).padStart(2, '0')}:00:00.000Z`,
  ...over,
});

beforeEach(() => {
  resetAuditState();
  server.use(...handlers);
});

describe('FR-7: audit log', () => {
  test('lists entries with staff, business, action, target and details', async () => {
    renderAudit();
    expect(await screen.findByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Audit log entries' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('staff@demo.test')).toBeInTheDocument();
    expect(within(row).getByText('Sweet Supply Co')).toBeInTheDocument();
    expect(within(row).getByText('plan.updated')).toBeInTheDocument();
    expect(within(row).getByText(`plan ${ids.plan.slice(0, 8)}`)).toBeInTheDocument();
    expect(within(row).getByText('{"fields":["name"]}')).toBeInTheDocument();
  });

  test('an entry without a Business shows a dash', async () => {
    auditState.entries = [
      entry(1, { business: null, action: 'settings.ai.updated', targetId: null }),
    ];
    renderAudit();
    const table = await screen.findByRole('table', { name: 'Audit log entries' });
    expect(within(table).getAllByRole('cell')[2]).toHaveTextContent('—');
  });

  test('shows an empty state', async () => {
    auditState.entries = [];
    renderAudit();
    expect(await screen.findByText('No entries')).toBeInTheDocument();
    expect(screen.getByText('Staff actions will show up here.')).toBeInTheDocument();
  });

  test('shows an error with retry', async () => {
    auditState.fail = true;
    renderAudit();
    expect(await screen.findByText('The audit log did not load')).toBeInTheDocument();
    auditState.fail = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('table', { name: 'Audit log entries' })).toBeInTheDocument();
  });

  describe('filters', () => {
    beforeEach(() => {
      auditState.entries = [
        entry(1),
        entry(2, {
          staff: { id: other.staff, email: 'second@demo.test' },
          business: { id: other.business, name: 'Corner Coffee Roasters' },
          action: 'credits.granted',
        }),
        entry(3, { business: null, action: 'settings.email.updated' }),
      ];
    });

    test('filters by Business, sending businessId', async () => {
      const user = userEvent.setup();
      renderAudit();
      await screen.findByRole('table', { name: 'Audit log entries' });
      await waitFor(() =>
        expect(screen.getByRole('option', { name: 'Corner Coffee Roasters' })).toBeInTheDocument(),
      );
      await user.selectOptions(screen.getByLabelText('Business'), 'Corner Coffee Roasters');
      await waitFor(() => {
        const rows = within(screen.getByRole('table')).getAllByRole('row');
        expect(rows).toHaveLength(2);
      });
      expect(within(screen.getByRole('table')).getByText('credits.granted')).toBeInTheDocument();
      expect(auditState.requests.at(-1)?.get('businessId')).toBe(other.business);
      // The choices survive filtering.
      expect(screen.getByRole('option', { name: 'Sweet Supply Co' })).toBeInTheDocument();
    });

    test('filters by Staff, sending staffMemberId', async () => {
      const user = userEvent.setup();
      renderAudit();
      await waitFor(() =>
        expect(screen.getByRole('option', { name: 'second@demo.test' })).toBeInTheDocument(),
      );
      await user.selectOptions(screen.getByLabelText('Staff'), 'second@demo.test');
      await waitFor(() =>
        expect(auditState.requests.at(-1)?.get('staffMemberId')).toBe(other.staff),
      );
      await waitFor(() =>
        expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2),
      );
    });

    test('filters by Action on Enter, sending the exact action', async () => {
      const user = userEvent.setup();
      renderAudit();
      await screen.findByRole('table', { name: 'Audit log entries' });
      await user.type(screen.getByLabelText('Action'), 'settings.email.updated{Enter}');
      await waitFor(() =>
        expect(auditState.requests.at(-1)?.get('action')).toBe('settings.email.updated'),
      );
      await waitFor(() =>
        expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2),
      );
    });

    test('filters combine, and Clear filters restores everything', async () => {
      const user = userEvent.setup();
      renderAudit();
      await waitFor(() =>
        expect(screen.getByRole('option', { name: 'Corner Coffee Roasters' })).toBeInTheDocument(),
      );
      await user.selectOptions(screen.getByLabelText('Business'), 'Corner Coffee Roasters');
      await user.type(screen.getByLabelText('Action'), 'plan.updated{Enter}');
      expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument();
      const last = auditState.requests.at(-1);
      expect(last?.get('businessId')).toBe(other.business);
      expect(last?.get('action')).toBe('plan.updated');

      await user.click(screen.getByRole('button', { name: 'Clear filters' }));
      await waitFor(() =>
        expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4),
      );
      expect(screen.getByLabelText('Action')).toHaveValue('');
    });
  });

  describe('paging', () => {
    test('Load more fetches the next page with the cursor and appends it', async () => {
      const user = userEvent.setup();
      auditState.entries = Array.from({ length: 120 }, (_, i) =>
        entry(i + 1, { action: `a.n${i + 1}` }),
      );
      renderAudit();
      const table = await screen.findByRole('table', { name: 'Audit log entries' });
      expect(within(table).getAllByRole('row')).toHaveLength(51);

      await user.click(screen.getByRole('button', { name: 'Load more' }));
      await waitFor(() =>
        expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(101),
      );
      expect(auditState.requests.some((q) => q.get('cursor') === '50')).toBe(true);

      await user.click(screen.getByRole('button', { name: 'Load more' }));
      await waitFor(() =>
        expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(121),
      );
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });

    test('there is no Load more on a single page', async () => {
      renderAudit();
      await screen.findByRole('table', { name: 'Audit log entries' });
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });
  });
});
