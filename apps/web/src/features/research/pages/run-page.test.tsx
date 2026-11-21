import { ids } from '@app/contracts/examples';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeRun, researchState, resetResearchState } from '../test/handlers';
import { renderRun } from '../test/render';

beforeEach(resetResearchState);

describe('FR-3: Report a problem on a failed run', () => {
  const path = `/runs/${ids.run}`;

  test('a failed run links to New ticket with the run attached, source run and the page', async () => {
    researchState.run = makeRun({
      status: 'failed',
      failureReason: 'PROVIDER_ERROR',
      creditsSpent: 0,
    });
    renderRun(path);
    const link = await screen.findByRole('link', { name: /Report a problem/ });
    const url = new URL(link.getAttribute('href')!, 'http://app.test');
    expect(url.pathname).toBe('/support/new');
    expect(url.searchParams.get('runId')).toBe(ids.run);
    expect(url.searchParams.get('source')).toBe('run');
    expect(url.searchParams.get('from')).toBe(`/app${path}`);
    expect(link).toHaveTextContent('Something wrong? Report a problem');
    expect(
      screen.getByText('Report a problem opens a ticket with this run attached.'),
    ).toBeInTheDocument();
  });

  test('sits after Try again and Back to plan', async () => {
    researchState.run = makeRun({ status: 'failed', failureReason: 'PROVIDER_ERROR' });
    renderRun(path);
    await screen.findByRole('link', { name: /Report a problem/ });
    const names = screen
      .getAllByRole('button')
      .concat(screen.getAllByRole('link'))
      .filter((el) => /Try again|Back to plan|Report a problem/.test(el.textContent ?? ''))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map((el) => el.textContent);
    expect(names).toEqual(['Try again', 'Back to plan', 'Something wrong? Report a problem']);
  });

  test('a completed run has no Report a problem link', async () => {
    researchState.run = makeRun({ status: 'completed' });
    renderRun(path);
    await screen.findByRole('link', { name: 'See leads' });
    expect(screen.queryByRole('link', { name: /Report a problem/ })).not.toBeInTheDocument();
  });
});
