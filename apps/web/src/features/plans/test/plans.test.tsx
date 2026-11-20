import { insufficientCreditsError } from '@app/contracts/errors';
import { errorResponse } from '@app/contracts/errors';
import { ids, plan as planExample, runSummary } from '@app/contracts/examples';
import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { server } from '../../../test/setup';
import { plansState, resetPlansState } from './handlers';
import { mapCalls, resetMapCalls } from './maplibre-mock';
import { renderPlans } from './render';

vi.mock('maplibre-gl', () => import('./maplibre-mock'));

const planPath = `/plans/${ids.plan}`;
const otherProduct = {
  id: '0193a1b2-0000-7000-8000-0000000000b1',
  name: 'Powdered sugar, 25 lb',
  description: '',
};

const setPlan = (patch: Partial<typeof planExample>) => {
  plansState.plans = [{ ...planExample, ...patch }];
};

/** POST /api/plans/:id/runs answers with `status` (201 starts a queued run). */
function runEndpoint(answer: { status: 201 } | { status: 402 | 403 | 409 | 503; code: string }) {
  const calls: number[] = [];
  server.use(
    http.post('*/api/plans/:id/runs', () => {
      calls.push(Date.now());
      if (answer.status === 201) {
        return HttpResponse.json(
          { ...runSummary, status: 'queued', startedAt: null, finishedAt: null },
          { status: 201 },
        );
      }
      if (answer.status === 402) {
        return HttpResponse.json(
          insufficientCreditsError.parse({
            error: {
              code: 'INSUFFICIENT_CREDITS',
              message: 'No',
              details: { available: 120, required: 400 },
            },
          }),
          { status: 402 },
        );
      }
      return HttpResponse.json(
        errorResponse.parse({ error: { code: answer.code, message: answer.code } }),
        { status: answer.status },
      );
    }),
  );
  return calls;
}

beforeEach(() => {
  resetPlansState();
  resetMapCalls();
  server.use(
    http.get('*/api/profile', async () => {
      const { profile } = await import('@app/contracts/examples');
      return HttpResponse.json({ ...profile, products: [...profile.products, otherProduct] });
    }),
  );
});

describe('Plans list (PRD 6b)', () => {
  test('lists plans with radius, last run, leads, credits and status', async () => {
    setPlan({});
    renderPlans();
    const table = await screen.findByRole('table', { name: 'Your plans' });
    const row = within(table).getByRole('row', { name: /Bakeries near Austin/ });
    expect(within(row).getByRole('link', { name: 'Bakeries near Austin' })).toHaveAttribute(
      'href',
      planPath,
    );
    expect(within(row).getByText('3 mi')).toBeInTheDocument();
    expect(within(row).getByText('137')).toBeInTheDocument();
    expect(within(row).getByText('READY')).toBeInTheDocument();
    expect(
      within(row).getByRole('link', { name: 'View leads for Bakeries near Austin' }),
    ).toHaveAttribute('href', `${planPath}/leads`);
  });

  test('a plan with a running run links to its progress', async () => {
    setPlan({ lastRun: { ...runSummary, status: 'running', finishedAt: null } });
    renderPlans();
    const link = await screen.findByRole('link', {
      name: 'View progress for Bakeries near Austin',
    });
    expect(link).toHaveAttribute('href', `/runs/${ids.run}`);
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
  });

  test('no plans: "Tell us who you want to find" with a New plan button', async () => {
    plansState.plans = [];
    renderPlans();
    expect(
      await screen.findByRole('heading', { name: 'Tell us who you want to find' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'New plan' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'New plan' })).toBeInTheDocument();
  });

  test('a load failure shows an error state', async () => {
    server.use(http.get('*/api/plans', () => new HttpResponse(null, { status: 500 })));
    renderPlans();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('FR-16: create a Plan from a Goal', () => {
  test('drafting shows "Drafting your plan…" then opens the Plan', async () => {
    server.use(
      http.post('*/api/plans', async () => {
        await delay(80);
        return undefined;
      }),
    );
    renderPlans('/plans/new');
    const goal = await screen.findByLabelText('Who would you like to find?');
    await userEvent.type(goal, 'bakeries within 3 miles that could buy our sugar');
    await userEvent.click(screen.getByRole('button', { name: 'Draft plan' }));
    expect(await screen.findByText('Drafting your plan…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft plan' })).toBeDisabled();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bakeries near Austin' }),
    ).toBeInTheDocument();
    expect(plansState.created).toEqual([
      { goal: 'bakeries within 3 miles that could buy our sugar' },
    ]);
    expect(screen.getByTestId('location')).toHaveTextContent(planPath);
  });

  test('warnings from drafting are shown on the Plan', async () => {
    plansState.create = {
      status: 201,
      warnings: ["We couldn't find 'Atlantis', so we used your address."],
    };
    renderPlans('/plans/new');
    await userEvent.type(
      await screen.findByLabelText('Who would you like to find?'),
      'bakeries in Atlantis',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Draft plan' }));
    expect(
      await screen.findByText("We couldn't find 'Atlantis', so we used your address."),
    ).toBeInTheDocument();
  });

  test('503 keeps the goal and offers another try', async () => {
    plansState.create = { status: 503 };
    renderPlans('/plans/new');
    const goal = await screen.findByLabelText('Who would you like to find?');
    await userEvent.type(goal, 'bakeries nearby');
    await userEvent.click(screen.getByRole('button', { name: 'Draft plan' }));
    expect(await screen.findByText(/couldn't draft your plan just now/)).toBeInTheDocument();
    expect(goal).toHaveValue('bakeries nearby');
    expect(screen.getByRole('button', { name: 'Draft plan' })).toBeEnabled();
  });

  test('an incomplete profile points to the chat', async () => {
    plansState.create = { status: 422 };
    renderPlans('/plans/new');
    await userEvent.type(
      await screen.findByLabelText('Who would you like to find?'),
      'bakeries nearby',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Draft plan' }));
    expect(await screen.findByText(/Finish your business profile first/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Open the chat' }));
    expect(await screen.findByText('Chat page')).toBeInTheDocument();
  });

  test('a goal under 5 characters is rejected before calling the API', async () => {
    renderPlans('/plans/new');
    await userEvent.type(await screen.findByLabelText('Who would you like to find?'), 'bak');
    await userEvent.click(screen.getByRole('button', { name: 'Draft plan' }));
    expect(await screen.findByText(/at least 5 characters/)).toBeInTheDocument();
    expect(plansState.created).toHaveLength(0);
  });

  test('suggestions come from the profile Products and fill the goal', async () => {
    renderPlans('/plans/new');
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Local businesses that could buy our Powdered sugar, 25 lb',
      }),
    );
    expect(screen.getByLabelText('Who would you like to find?')).toHaveValue(
      'Local businesses that could buy our Powdered sugar, 25 lb',
    );
  });
});

describe('FR-17: edit a Plan and see the estimate', () => {
  test('shows target types, signals, exclusions, area, budget and the estimate', async () => {
    renderPlans(planPath);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bakeries near Austin' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Goal: "Bakeries within 3 miles that could buy our cane sugar"'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Who to find · 1 target type' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Target type 1 name')).toHaveValue('Bakeries');
    expect(screen.getByLabelText('Pitch for target type 1')).toHaveDisplayValue(
      'Cane sugar, 50 lb',
    );
    expect(screen.getByText('Bakes on site')).toBeInTheDocument();
    expect(screen.getByText('Chains')).toBeInTheDocument();
    expect(screen.getByText('Centre: Austin, TX')).toBeInTheDocument();
    expect(screen.getByLabelText('Max credits')).toHaveValue(400);
    expect(screen.getByLabelText('Max leads')).toHaveValue(50);
    expect(screen.getByLabelText('Min fit score')).toHaveValue(60);
    expect(screen.getByText('Up to 400 credits · usually 240')).toBeInTheDocument();
    expect(screen.getByText('Available: 863 credits')).toBeInTheDocument();
  });

  test('the map preview draws a pin and a circle for the search area', async () => {
    renderPlans(planPath);
    await screen.findByRole('img', { name: 'Map preview · 3 mi around Austin, TX' });
    await waitFor(() => expect(mapCalls.sources).toHaveLength(1));
    expect(mapCalls.maps[0]).toMatchObject({ center: [-97.7431, 30.2672] });
    expect(mapCalls.pins[0]).toEqual([-97.7431, 30.2672]);
    expect(mapCalls.layers).toEqual(['search-radius-fill', 'search-radius-line']);
    expect(mapCalls.sources[0]?.data).toMatchObject({ geometry: { type: 'Polygon' } });
  });

  test('changing a Fit signal and an exclusion saves the segments', async () => {
    renderPlans(planPath);
    await screen.findByText('Bakes on site');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bakes on site' }));
    await userEvent.type(
      screen.getByLabelText('Add a fit signal to target type 1'),
      'Sells cakes{Enter}',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove Chains' }));
    await userEvent.type(
      screen.getByLabelText('Add something to skip in target type 1'),
      'Franchises{Enter}',
    );
    expect(screen.getByText('Save your changes to update the estimate.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Plan saved')).toBeInTheDocument();
    expect(plansState.patched[0]).toMatchObject({
      segments: [
        {
          id: ids.segment,
          fitSignals: ['Sells cakes'],
          exclusions: ['Franchises'],
          productId: ids.product,
        },
      ],
    });
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  test('changing the product pitched by a segment', async () => {
    renderPlans(planPath);
    await userEvent.selectOptions(
      await screen.findByLabelText('Pitch for target type 1'),
      otherProduct.id,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Plan saved');
    expect(plansState.patched[0]).toMatchObject({ segments: [{ productId: otherProduct.id }] });
  });

  test('segments: at least 1 and at most 5, and a new one needs a name and a signal', async () => {
    renderPlans(planPath);
    await screen.findByLabelText('Target type 1 name');
    expect(screen.getByRole('button', { name: 'Remove target type 1' })).toBeDisabled();
    for (let i = 0; i < 4; i++)
      await userEvent.click(screen.getByRole('button', { name: 'Add target type' }));
    expect(screen.getByRole('button', { name: 'Add target type' })).toBeDisabled();
    expect(
      screen.getByRole('heading', { name: 'Who to find · 5 target types' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findAllByText('Give this target type a name')).toHaveLength(4);
    expect(screen.getAllByText('Add at least one fit signal')).toHaveLength(4);
    expect(plansState.patched).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Remove target type 5' }));
    expect(screen.getByRole('button', { name: 'Add target type' })).toBeEnabled();
  });

  test('radius: a slider from 1 to 25 and a typed value outside it is refused', async () => {
    renderPlans(planPath);
    const slider = await screen.findByRole('slider', { name: 'Radius slider' });
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '25');
    const radius = screen.getByLabelText('Radius (miles)');
    await userEvent.clear(radius);
    await userEvent.type(radius, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use 1 to 25 miles')).toBeInTheDocument();
    expect(radius).toHaveAttribute('aria-invalid', 'true');
    expect(plansState.patched).toHaveLength(0);
  });

  test('the radius saves and moves the circle on the map', async () => {
    renderPlans(planPath);
    const radius = await screen.findByLabelText('Radius (miles)');
    await waitFor(() => expect(mapCalls.sources).toHaveLength(1));
    await userEvent.clear(radius);
    await userEvent.type(radius, '10');
    await waitFor(() => expect(mapCalls.data.length).toBeGreaterThan(0));
    expect(
      screen.getByRole('img', { name: 'Map preview · 10 mi around Austin, TX' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Plan saved');
    expect(plansState.patched[0]).toMatchObject({ searchArea: { radiusMiles: 10 } });
  });

  test('400 field errors from the API show on the inputs', async () => {
    renderPlans(planPath);
    await screen.findByLabelText('Radius (miles)');
    await userEvent.type(screen.getByLabelText('Plan name'), ' two');
    plansState.patchFields = {
      'searchArea.radiusMiles': 'Number must be at most 25',
      'guardrails.maxCredits': 'Over the limit of 300',
    };
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Number must be at most 25')).toBeInTheDocument();
    expect(screen.getByText('Over the limit of 300')).toBeInTheDocument();
    expect(screen.getByLabelText('Max credits')).toHaveAttribute('aria-invalid', 'true');
  });

  test('guardrails are validated: max credits at least 10, fit score 40 to 90', async () => {
    renderPlans(planPath);
    const credits = await screen.findByLabelText('Max credits');
    await userEvent.clear(credits);
    await userEvent.type(credits, '5');
    const fit = screen.getByLabelText('Min fit score');
    await userEvent.clear(fit);
    await userEvent.type(fit, '95');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Use at least 10 credits')).toBeInTheDocument();
    expect(screen.getByText('Use a score from 40 to 90')).toBeInTheDocument();
    expect(plansState.patched).toHaveLength(0);
  });

  test('saving guardrails refreshes the estimate', async () => {
    renderPlans(planPath);
    const credits = await screen.findByLabelText('Max credits');
    await userEvent.clear(credits);
    await userEvent.type(credits, '300');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Up to 300 credits · usually 240')).toBeInTheDocument();
  });

  test('place search picks a new centre and saves it', async () => {
    renderPlans(planPath);
    await userEvent.type(await screen.findByLabelText('Search for a place'), 'Round Rock{Enter}');
    expect(plansState.searched).toEqual(['Round Rock']);
    await userEvent.click(await screen.findByRole('button', { name: 'Round Rock, TX' }));
    expect(screen.getByText('Centre: Round Rock, TX')).toBeInTheDocument();
    await waitFor(() => expect(mapCalls.pins.at(-1)).toEqual([-97.6789, 30.5083]));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Plan saved');
    expect(plansState.patched[0]).toMatchObject({
      searchArea: { label: 'Round Rock, TX', lat: 30.5083, lng: -97.6789, radiusMiles: 3 },
    });
  });

  test('a place search with no match says so', async () => {
    plansState.places = [];
    renderPlans(planPath);
    await userEvent.type(await screen.findByLabelText('Search for a place'), 'Nowhere');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No places found. Try another name.')).toBeInTheDocument();
  });

  test('an unknown plan shows "Plan not found"', async () => {
    renderPlans('/plans/0193a1b2-0000-7000-8000-0000000000ff');
    expect(await screen.findByRole('heading', { name: 'Plan not found' })).toBeInTheDocument();
  });
});

describe('FR-18 (client side): Find leads', () => {
  test('starts the run and opens its working screen', async () => {
    const calls = runEndpoint({ status: 201 });
    setPlan({ lastRun: null, leadsCount: 0 });
    renderPlans(planPath);
    await userEvent.click(await screen.findByRole('button', { name: 'Find leads' }));
    expect(await screen.findByText(`Run page ${ids.run}`)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  test('unsaved edits are saved before the run starts', async () => {
    runEndpoint({ status: 201 });
    renderPlans(planPath);
    const leads = await screen.findByLabelText('Max leads');
    await userEvent.clear(leads);
    await userEvent.type(leads, '80');
    await userEvent.click(screen.getByRole('button', { name: 'Find leads' }));
    expect(await screen.findByText(`Run page ${ids.run}`)).toBeInTheDocument();
    expect(plansState.patched[0]).toMatchObject({ guardrails: { maxLeads: 80 } });
  });

  test('a Plan whose run is queued or running shows View progress instead', async () => {
    setPlan({ lastRun: { ...runSummary, status: 'queued', finishedAt: null } });
    renderPlans(planPath);
    const link = await screen.findByRole('link', { name: 'View progress' });
    expect(link).toHaveAttribute('href', `/runs/${ids.run}`);
    expect(screen.queryByRole('button', { name: 'Find leads' })).not.toBeInTheDocument();
  });

  test('a finished Plan links to its leads', async () => {
    renderPlans(planPath);
    expect(await screen.findByRole('link', { name: 'View 25 leads' })).toHaveAttribute(
      'href',
      `${planPath}/leads`,
    );
  });

  describe('402: not enough credits (AJ-4)', () => {
    beforeEach(() => setPlan({ lastRun: null, available: 120 }));

    test('the dialog says what is needed and what you have', async () => {
      const calls = runEndpoint({ status: 402, code: 'INSUFFICIENT_CREDITS' });
      renderPlans(planPath);
      await userEvent.click(await screen.findByRole('button', { name: 'Find leads' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'You need 400 credits, you have 120',
      });
      expect(
        within(dialog).getByRole('button', { name: 'Lower the budget to 120' }),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Buy credits' })).toBeInTheDocument();
      expect(calls).toHaveLength(1);
    });

    test('"Lower the budget" lowers max credits to the balance and starts the run', async () => {
      runEndpoint({ status: 402, code: 'INSUFFICIENT_CREDITS' });
      renderPlans(planPath);
      await userEvent.click(await screen.findByRole('button', { name: 'Find leads' }));
      const dialog = await screen.findByRole('dialog');
      runEndpoint({ status: 201 });
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Lower the budget to 120' }),
      );
      expect(await screen.findByText(`Run page ${ids.run}`)).toBeInTheDocument();
      expect(plansState.patched[0]).toMatchObject({
        guardrails: { maxCredits: 120, maxLeads: 50, minFitScore: 60 },
      });
    });

    test('"Buy credits" goes to the credits page', async () => {
      runEndpoint({ status: 402, code: 'INSUFFICIENT_CREDITS' });
      renderPlans(planPath);
      await userEvent.click(await screen.findByRole('button', { name: 'Find leads' }));
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Buy credits' }),
      );
      expect(await screen.findByText('Credits page')).toBeInTheDocument();
    });

    test('Cancel closes the dialog and changes nothing', async () => {
      runEndpoint({ status: 402, code: 'INSUFFICIENT_CREDITS' });
      renderPlans(planPath);
      await userEvent.click(await screen.findByRole('button', { name: 'Find leads' }));
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(plansState.patched).toHaveLength(0);
    });
  });

  test('403 EMAIL_NOT_VERIFIED asks to verify the email', async () => {
    runEndpoint({ status: 403, code: 'EMAIL_NOT_VERIFIED' });
    setPlan({ lastRun: null });
    renderPlans(planPath);
    await userEvent.click(await screen.findByRole('button', { name: 'Find leads' }));
    expect(await screen.findByText('Verify your email to start research.')).toBeInTheDocument();
  });

  test('409 RUN_IN_PROGRESS offers View progress', async () => {
    runEndpoint({ status: 409, code: 'RUN_IN_PROGRESS' });
    setPlan({ lastRun: null });
    renderPlans(planPath);
    await userEvent.click(await screen.findByRole('button', { name: 'Find leads' }));
    expect(
      await screen.findByText('Another research run is already in progress.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View progress' })).toBeInTheDocument();
  });

  test('503 RESEARCH_UNAVAILABLE says research is not available', async () => {
    runEndpoint({ status: 503, code: 'RESEARCH_UNAVAILABLE' });
    setPlan({ lastRun: null });
    renderPlans(planPath);
    await userEvent.click(await screen.findByRole('button', { name: 'Find leads' }));
    expect(await screen.findByText(/Research isn't available right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find leads' })).toBeEnabled();
  });
});
