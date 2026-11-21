import { ids } from '@app/contracts/examples';
import { listPlanRuns } from '@app/contracts/research';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../test/setup';
import { leadsState, otherRunId, resetLeadsState } from '../test/handlers';
import { renderLeads } from '../test/render';

beforeEach(resetLeadsState);

const listPath = `/plans/${ids.plan}/leads`;
const reportLink = () => screen.findByRole('link', { name: 'Report a problem' });
const query = (link: HTMLElement) =>
  new URL(link.getAttribute('href')!, 'http://app.test').searchParams;

describe('FR-3: Report a problem on the Lead list', () => {
  test("links to New ticket with the Plan's latest run, source leads and the page", async () => {
    renderLeads(listPath);
    // The runs load after the page; the link follows them.
    await expect
      .poll(async () => query(await reportLink()).get('runId'))
      .toBe(leadsState.runs[0]!.id);
    expect(new URL((await reportLink()).getAttribute('href')!, 'http://app.test').pathname).toBe(
      '/support/new',
    );
    const final = query(await reportLink());
    expect(final.get('source')).toBe('leads');
    expect(final.get('from')).toBe(`/app${listPath}`);
  });

  test('uses the first run the API lists (newest first)', async () => {
    leadsState.runs = [leadsState.runs[1]!, leadsState.runs[0]!];
    renderLeads(listPath);
    await expect.poll(async () => query(await reportLink()).get('runId')).toBe(otherRunId);
  });

  test('a Plan without runs links with source leads and no run', async () => {
    server.use(
      http.get('*/api/plans/:id/runs', () =>
        HttpResponse.json(listPlanRuns.response.parse({ items: [], nextCursor: null })),
      ),
    );
    renderLeads(listPath);
    const link = await reportLink();
    await screen.findByRole('list', { name: 'Lead list' });
    expect(query(link).get('source')).toBe('leads');
    expect(query(link).has('runId')).toBe(false);
  });
});
