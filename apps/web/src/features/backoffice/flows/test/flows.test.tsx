import { BUDGET_SHARES_MESSAGE } from '@app/contracts/research';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../../test/setup';
import { flowsState, handlers, resetFlowsState } from './handlers';
import { renderFlows } from './render';

beforeEach(() => {
  resetFlowsState();
  server.use(...handlers);
});

async function open() {
  const user = userEvent.setup();
  renderFlows();
  await screen.findByRole('heading', { level: 2, name: /Local buyers/ });
  return user;
}

const setValue = async (
  user: ReturnType<typeof userEvent.setup>,
  el: HTMLElement,
  text: string,
) => {
  await user.clear(el);
  await user.type(el, text);
};

describe('FR-37: research flows list and editor', () => {
  test('lists the default flow with version and usage, and shows the editor', async () => {
    await open();
    const list = screen.getByRole('region', { name: 'Flows' });
    expect(within(list).getByText('v3')).toBeInTheDocument();
    expect(within(list).getByText('● Default')).toBeInTheDocument();
    expect(within(list).getByText(/Used by 12 plans · updated Nov 19/)).toBeInTheDocument();
    expect(screen.getByLabelText('Max active work time')).toHaveValue('60');
    expect(screen.getByLabelText('Wait between attempts')).toHaveValue('1, 5, 15');
    expect(screen.getByLabelText('Budget (credits)')).toHaveValue('400');
    expect(screen.getByRole('button', { name: 'Save as v4' })).toBeInTheDocument();
  });

  test('shows the ceilings as hints', async () => {
    await open();
    expect(screen.getByText('Ceiling 120 min (Settings)')).toBeInTheDocument();
    expect(screen.getByText('Ceiling 4 h (Settings)')).toBeInTheDocument();
    expect(screen.getByText('Ceiling 5 (Settings)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '/staff/settings',
    );
  });

  test('lists the steps with tools, budget share, time limit and required', async () => {
    await open();
    const table = screen.getByRole('table', { name: 'Flow steps' });
    const maps = within(within(table).getByRole('row', { name: /Maps & places/ }));
    expect(maps.getByText('google.places')).toBeInTheDocument();
    expect(maps.getByLabelText('Budget share, Maps & places')).toHaveValue('18');
    expect(maps.getByLabelText('Time limit, Maps & places')).toHaveValue('12');
    expect(
      within(within(table).getByRole('row', { name: /Merge/ })).getByText('No tools'),
    ).toBeInTheDocument();
    expect(screen.getByText('100% ✓')).toBeInTheDocument();
    expect(screen.getByText(/· 60 min/)).toBeInTheDocument();
  });

  test('steps 2, 8 and 9 are always required; others can be switched', async () => {
    const user = await open();
    for (const name of ['Maps & places', 'Verify', 'Score & pitch']) {
      const toggle = screen.getByRole('switch', { name: `Required, ${name}` });
      expect(toggle).toBeDisabled();
      expect(toggle).toBeChecked();
    }
    const socials = screen.getByRole('switch', { name: 'Required, Socials & reviews' });
    expect(socials).not.toBeChecked();
    await user.click(socials);
    expect(socials).toBeChecked();
  });

  test('total must be 100%: a wrong total shows the contract message and does not save', async () => {
    const user = await open();
    await setValue(user, screen.getByLabelText('Budget share, Deliver'), '0');
    expect(screen.getByText('98%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save as v4' }));
    expect(await screen.findByText(BUDGET_SHARES_MESSAGE)).toBeInTheDocument();
    expect(flowsState.saves).toEqual([]);
  });

  test('a value above a ceiling shows the ceiling inline and does not save', async () => {
    const user = await open();
    await setValue(user, screen.getByLabelText('Max total time, including retries'), '5');
    await setValue(user, screen.getByLabelText('Automatic attempts'), '6');
    await user.click(screen.getByRole('button', { name: 'Save as v4' }));
    expect(await screen.findByText('Above the ceiling of 4 h')).toBeInTheDocument();
    expect(screen.getByText('Above the ceiling of 5')).toBeInTheDocument();
    expect(flowsState.saves).toEqual([]);
  });

  test('step time limits must fit inside the max active work time', async () => {
    const user = await open();
    await setValue(user, screen.getByLabelText('Max active work time'), '30');
    await user.click(screen.getByRole('button', { name: 'Save as v4' }));
    expect(await screen.findByText(/Step time limits add up to 60 min/)).toBeInTheDocument();
    expect(flowsState.saves).toEqual([]);
  });

  test('rejects non-numbers and bad waits with inline messages', async () => {
    const user = await open();
    await setValue(user, screen.getByLabelText('Max active work time'), 'abc');
    await setValue(user, screen.getByLabelText('Wait between attempts'), '1, x');
    await setValue(user, screen.getByLabelText('Min fit score'), '10');
    await user.click(screen.getByRole('button', { name: 'Save as v4' }));
    expect(await screen.findByText('Enter a whole number')).toBeInTheDocument();
    expect(screen.getByText(/Enter whole minutes separated by commas/)).toBeInTheDocument();
    expect(screen.getByText('Enter 40 or more')).toBeInTheDocument();
    expect(flowsState.saves).toEqual([]);
  });

  test('saves as the next version, sends parsed numbers, and confirms', async () => {
    const user = await open();
    await setValue(user, screen.getByLabelText('Max total time, including retries'), '3.5');
    await setValue(user, screen.getByLabelText('Wait between attempts'), '2, 10');
    await user.click(screen.getByRole('switch', { name: 'Required, Socials & reviews' }));
    await user.click(screen.getByRole('button', { name: 'Save as v4' }));
    expect(await screen.findByText(/Saved as v4/)).toBeInTheDocument();
    expect(flowsState.saves).toHaveLength(1);
    expect(flowsState.saves[0]).toMatchObject({
      key: 'local-buyers',
      runSettings: { maxTotalHours: 3.5, retryWaitsMinutes: [2, 10], maxActiveMinutes: 60 },
      planDefaults: { maxCredits: 400 },
    });
    const sent = flowsState.saves[0] as { steps: { key: string; required: boolean }[] };
    expect(sent.steps.find((s) => s.key === 'socials-reviews')?.required).toBe(true);
    expect(sent.steps.find((s) => s.key === 'verify')?.required).toBe(true);
    expect(sent.steps).toHaveLength(10);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save as v5' })).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole('region', { name: 'Flows' })).getByText('v4'),
    ).toBeInTheDocument();
  });

  test('shows a server 400 on the named field', async () => {
    const user = await open();
    server.use(
      http.put('*/api/staff/flows/:key', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid',
              fields: {
                'runSettings.maxTotalHours': 'Ceiling 4 h (Settings)',
                'steps.1.budgetPct': 'Too high',
              },
            },
          },
          { status: 400 },
        ),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Save as v4' }));
    expect(await screen.findAllByText('Ceiling 4 h (Settings)')).toHaveLength(2); // hint and error
    expect(screen.getByText('Too high')).toBeInTheDocument();
  });

  test('shows the server 422 STEP_TIME_OVER_ACTIVE_TIME message under the steps', async () => {
    const user = await open();
    server.use(
      http.put('*/api/staff/flows/:key', () =>
        HttpResponse.json(
          {
            error: {
              code: 'STEP_TIME_OVER_ACTIVE_TIME',
              message: 'Step time limits add up to 61 min, more than the max active time (60 min)',
              details: { field: 'steps', totalMinutes: 61, maxActiveMinutes: 60 },
            },
          },
          { status: 422 },
        ),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Save as v4' }));
    const steps = screen.getByRole('region', { name: 'Steps' });
    expect(
      await within(steps).findByText(
        'Step time limits add up to 61 min, more than the max active time (60 min)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Fix the marked fields and save again.')).toBeInTheDocument();
    expect(screen.queryByText('We could not save this flow. Try again.')).not.toBeInTheDocument();
  });

  test('Discard restores the saved values', async () => {
    const user = await open();
    const input = screen.getByLabelText('Max active work time');
    await setValue(user, input, '90');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('Max active work time')).toHaveValue('60');
  });

  test('shows an error with retry when the list fails', async () => {
    server.use(
      http.get('*/api/staff/flows', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
      ),
    );
    renderFlows();
    expect(await screen.findByText('Research flows did not load')).toBeInTheDocument();
  });
});
