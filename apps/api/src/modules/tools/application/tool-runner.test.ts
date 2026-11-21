import { describe, expect, test } from 'vitest';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { BUSINESS, NOW, RUN, ScriptedAdapter, runnerFixture } from '../test/fakes.js';
import type { ToolCallRecord } from './ports.js';
import { adapterRegistry, ToolFailure } from './tool-adapter.js';
import { inputHash, ToolRunner } from './tool-runner.js';

const PLACES = 'google.places-text-search';

function request(overrides: Record<string, unknown> = {}) {
  return {
    businessId: BUSINESS,
    runId: RUN,
    stepKey: 'maps',
    attemptN: 1,
    toolKey: PLACES,
    input: { q: 'bakery', n: 20 },
    ...overrides,
  };
}

async function priced(
  f: Pick<ReturnType<typeof runnerFixture>, 'tools'>,
  credits: number,
  maxUnits = 20,
) {
  const tool = await f.tools.find(PLACES);
  if (!tool) throw new Error('missing');
  await f.tools.save({
    ...tool,
    creditsPerUnit: credits,
    providerCostMicrosPerUnit: 5_000,
    maxUnitsPerCall: maxUnits,
  });
}

describe('FR-23: ToolRunner metering', () => {
  test('20 units at 1.5 credits/unit records 30,000 millicredits', async () => {
    const f = runnerFixture();
    await priced(f, 1.5);
    const result = await f.runner.call(request());
    expect(result).toMatchObject({
      status: 'ok',
      units: 20,
      millicredits: 30_000,
      providerCostMicros: 100_000,
      reused: false,
      error: null,
    });
    expect(result.output).toEqual({ items: Array.from({ length: 20 }, (_, i) => `bakery-${i}`) });
    expect(f.calls.rows).toHaveLength(1);
    expect(f.calls.rows[0]).toMatchObject({
      id: result.toolCallId,
      runId: RUN,
      stepKey: 'maps',
      attemptN: 1,
      businessId: BUSINESS,
      toolKey: PLACES,
      inputHash: inputHash({ q: 'bakery', n: 20 }),
      input: { q: 'bakery', n: 20 },
      output: result.output,
      units: 20,
      millicredits: 30_000,
      providerCostMicros: 100_000,
      status: 'ok',
      reused: false,
      error: null,
      createdAt: NOW,
    });
  });

  test('the input hash is sha-256 hex of the canonical input (defaults applied)', async () => {
    const f = runnerFixture();
    await f.runner.call(request({ input: { q: 'bakery' } }));
    expect(f.calls.rows[0]?.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(f.calls.rows[0]?.inputHash).toBe(inputHash({ n: 1, q: 'bakery' }));
  });

  test('companion meters are recorded as their own Tool calls and summed', async () => {
    const claude = new ScriptedAdapter('claude.fast', () => ({
      output: { items: [] },
      units: 3,
      meters: [{ toolKey: 'claude.fast.out', units: 2 }],
    }));
    const g = runnerFixture({ adapters: [claude.registered('anthropic')] });
    const result = await g.runner.call(request({ toolKey: 'claude.fast', input: { q: 'x' } }));
    // fast in 0.03 credits = 30 millicredits/unit; out 0.15 = 150
    expect(result.millicredits).toBe(3 * 30 + 2 * 150);
    expect(g.calls.rows.map((r) => [r.toolKey, r.units, r.millicredits])).toEqual([
      ['claude.fast', 3, 90],
      ['claude.fast.out', 2, 300],
    ]);
  });
});

describe('FR-23: disabled and not configured', () => {
  test('a disabled Tool is not called and returns TOOL_DISABLED', async () => {
    const f = runnerFixture();
    const tool = await f.tools.find(PLACES);
    if (tool) await f.tools.save({ ...tool, enabled: false });
    const result = await f.runner.call(request());
    expect(f.places.calls).toHaveLength(0);
    expect(result).toMatchObject({ status: 'skipped', output: null, units: 0, millicredits: 0 });
    expect(result.error).toMatchObject({ code: 'TOOL_DISABLED', retryable: false });
    expect(f.calls.rows[0]).toMatchObject({ status: 'skipped', millicredits: 0 });
    expect(f.calls.rows[0]?.error).toMatch(/^TOOL_DISABLED/);
  });

  test('a missing provider key fails with PROVIDER_NOT_CONFIGURED without calling the adapter', async () => {
    const f = runnerFixture();
    f.settings.credentials.googleMaps = { apiKey: null };
    const result = await f.runner.call(request());
    expect(f.places.calls).toHaveLength(0);
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  test('an unknown Tool is a programming error', async () => {
    const f = runnerFixture();
    await expect(f.runner.call(request({ toolKey: 'nope' }))).rejects.toThrow(NotFoundError);
  });

  test('an invalid input fails with INVALID_INPUT without calling the adapter', async () => {
    const f = runnerFixture();
    const result = await f.runner.call(request({ input: { q: '' } }));
    expect(f.places.calls).toHaveLength(0);
    expect(result.error).toMatchObject({ code: 'INVALID_INPUT', retryable: false });
    expect(result.error?.message).toContain('q');
  });
});

describe('FR-36: reuse of stored Tool calls', () => {
  test('the same Tool and input in the same run and Step is answered from storage at 0 credits', async () => {
    const f = runnerFixture();
    await priced(f, 1.5);
    const first = await f.runner.call(request());
    const second = await f.runner.call(request({ attemptN: 2, input: { n: 20, q: 'bakery' } }));
    expect(f.places.calls).toHaveLength(1);
    expect(second).toMatchObject({ status: 'ok', reused: true, units: 0, millicredits: 0 });
    expect(second.output).toEqual(first.output);
    expect(f.calls.rows[1]).toMatchObject({
      reused: true,
      attemptN: 2,
      millicredits: 0,
      status: 'ok',
    });
  });

  test('a different input, Step or run calls the provider again', async () => {
    const f = runnerFixture();
    await f.runner.call(request());
    await f.runner.call(request({ input: { q: 'pastry', n: 20 } }));
    await f.runner.call(request({ stepKey: 'other' }));
    await f.runner.call(request({ runId: '00000000-0000-7000-8000-00000000a002' }));
    expect(f.places.calls).toHaveLength(4);
  });

  test('failed calls are not reused', async () => {
    const f = runnerFixture();
    f.places.then(() => Promise.reject(ToolFailure.final('bad request')));
    expect((await f.runner.call(request())).status).toBe('error');
    expect((await f.runner.call(request())).reused).toBe(false);
    expect(f.places.calls).toHaveLength(2);
  });

  test('calls without a run are never reused', async () => {
    const f = runnerFixture();
    await f.runner.call(request({ runId: null, stepKey: null }));
    await f.runner.call(request({ runId: null, stepKey: null }));
    expect(f.places.calls).toHaveLength(2);
  });
});

describe('FR-20: budget', () => {
  test('a call whose max cost exceeds the budget is skipped with BUDGET_EXCEEDED', async () => {
    const f = runnerFixture();
    await priced(f, 1.5);
    const result = await f.runner.call(request({ budget: { remainingMillicredits: 29_999 } }));
    expect(f.places.calls).toHaveLength(0);
    expect(result).toMatchObject({ status: 'skipped', millicredits: 0 });
    expect(result.error?.code).toBe('BUDGET_EXCEEDED');
  });

  test('a call whose max cost fits runs', async () => {
    const f = runnerFixture();
    await priced(f, 1.5);
    const result = await f.runner.call(request({ budget: { remainingMillicredits: 30_000 } }));
    expect(result.status).toBe('ok');
  });

  test('max cost is capped at the Tool max units per call', async () => {
    const f = runnerFixture();
    await priced(f, 1.5, 5);
    const result = await f.runner.call(request({ budget: { remainingMillicredits: 7_500 } }));
    expect(result.status).toBe('ok');
  });

  test('a stored answer is reused even when the budget is spent', async () => {
    const f = runnerFixture();
    await f.runner.call(request());
    const again = await f.runner.call(request({ budget: { remainingMillicredits: 0 } }));
    expect(again).toMatchObject({ status: 'ok', reused: true });
  });
});

describe('FR-20: retries', () => {
  test('retryable errors are retried after 1 s, 4 s and 16 s, then succeed', async () => {
    const f = runnerFixture();
    f.places
      .then(() => Promise.reject(ToolFailure.retryable('503')))
      .then(() => Promise.reject(ToolFailure.retryable('timeout')))
      .then(() => Promise.reject(ToolFailure.retryable('429')));
    const result = await f.runner.call(request());
    expect(result.status).toBe('ok');
    expect(f.sleeper.waits).toEqual([1_000, 4_000, 16_000]);
    expect(f.places.calls).toHaveLength(4);
    expect(f.calls.rows).toHaveLength(1);
  });

  test('after 3 retries the call fails with the last error, retryable, at 0 credits', async () => {
    const f = runnerFixture();
    for (let i = 0; i < 4; i++)
      f.places.then(() => Promise.reject(ToolFailure.retryable(`down ${i}`)));
    const result = await f.runner.call(request());
    expect(result).toMatchObject({ status: 'error', units: 0, millicredits: 0 });
    expect(result.error).toEqual({ code: 'PROVIDER_ERROR', message: 'down 3', retryable: true });
    expect(f.calls.rows[0]).toMatchObject({ status: 'error', error: 'PROVIDER_ERROR: down 3' });
  });

  test('a final error is not retried', async () => {
    const f = runnerFixture();
    f.places.then(() => Promise.reject(ToolFailure.final('404')));
    const result = await f.runner.call(request());
    expect(f.sleeper.waits).toEqual([]);
    expect(result.error).toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
  });

  test('an unexpected exception is recorded, not thrown', async () => {
    const f = runnerFixture();
    f.places.then(() => Promise.reject(new TypeError('boom')));
    const result = await f.runner.call(request());
    expect(result.error).toMatchObject({ code: 'PROVIDER_ERROR', message: 'boom' });
  });

  test('output that breaks the output schema fails with INVALID_OUTPUT', async () => {
    const f = runnerFixture();
    f.places.then(() => Promise.resolve({ output: { items: [1] }, units: 1 }));
    const result = await f.runner.call(request());
    expect(result.error?.code).toBe('INVALID_OUTPUT');
    expect(result.millicredits).toBe(0);
  });
});

describe('FR-19 / FR-36: deferred recording (the provider runs outside any transaction)', () => {
  /** A runner whose repository logs which transaction each write used. */
  function deferredFixture() {
    const base = runnerFixture();
    const log: { op: 'add' | 'complete'; within: string | undefined; statuses: string[] }[] = [];
    const repo = (within?: { tx: string }) => ({
      ...base.calls,
      findReusable: base.calls.findReusable.bind(base.calls),
      listForRun: base.calls.listForRun.bind(base.calls),
      statsSince: base.calls.statsSince.bind(base.calls),
      spendBetween: base.calls.spendBetween.bind(base.calls),
      costByToolBetween: base.calls.costByToolBetween.bind(base.calls),
      add: (records: readonly ToolCallRecord[]) => {
        log.push({ op: 'add', within: within?.tx, statuses: records.map((r) => r.status) });
        return base.calls.add(records);
      },
      complete: (record: ToolCallRecord) => {
        log.push({ op: 'complete', within: within?.tx, statuses: [record.status] });
        return base.calls.complete(record);
      },
    });
    const runner = new ToolRunner<{ tx: string }>({
      tools: base.tools,
      calls: repo,
      adapters: adapterRegistry([base.places.registered()]),
      settings: base.settings,
      clock: base.clock,
      ids: base.ids,
      sleeper: base.sleeper,
    });
    return { ...base, runner, log };
  }

  test('a provider call is stored as started first; commit(within) stores its outcome in that transaction', async () => {
    const f = deferredFixture();
    await priced(f, 1.5);
    let seenWhileRunning: string[] = [];
    f.places.then(() => {
      seenWhileRunning = f.calls.rows.map((r) => r.status);
      return Promise.resolve({ output: { items: ['a', 'b'] }, units: 2 });
    });
    const result = await f.runner.call({ ...request(), defer: true });
    expect(seenWhileRunning).toEqual(['started']);
    expect(result).toMatchObject({ status: 'ok', units: 2, millicredits: 3_000, reused: false });
    // Nothing but the started row until the caller commits.
    expect(f.calls.rows.map((r) => r.status)).toEqual(['started']);
    expect(f.log).toEqual([{ op: 'add', within: undefined, statuses: ['started'] }]);

    await result.commit?.({ tx: 'save-1' });
    expect(f.log[1]).toEqual({ op: 'complete', within: 'save-1', statuses: ['ok'] });
    expect(f.calls.rows).toHaveLength(1);
    expect(f.calls.rows[0]).toMatchObject({
      id: result.toolCallId,
      status: 'ok',
      units: 2,
      millicredits: 3_000,
      output: { items: ['a', 'b'] },
    });
  });

  test('a started call is never reused and does not count in health or spend', async () => {
    const f = deferredFixture();
    const first = await f.runner.call({ ...request(), defer: true });
    expect(first.status).toBe('ok');
    // The worker stopped before committing: the next attempt calls the provider again.
    const second = await f.runner.call({ ...request(), defer: true });
    expect(second.reused).toBe(false);
    expect(f.places.calls).toHaveLength(2);
    expect(await f.calls.statsSince(NOW)).toEqual(new Map());
    expect(await f.calls.spendBetween({ from: NOW, to: new Date(NOW.getTime() + 1) })).toEqual([]);
  });

  test('reused, skipped and refused calls write nothing until commit', async () => {
    const f = deferredFixture();
    const paid = await f.runner.call({ ...request(), defer: true });
    await paid.commit?.({ tx: 'save-1' });
    const reused = await f.runner.call({ ...request(), defer: true });
    expect(reused).toMatchObject({ status: 'ok', reused: true, millicredits: 0 });
    const tool = await f.tools.find(PLACES);
    await f.tools.save({ ...tool!, enabled: false });
    const disabled = await f.runner.call({ ...request({ input: { q: 'cafe' } }), defer: true });
    expect(disabled.error?.code).toBe('TOOL_DISABLED');
    expect(f.calls.rows).toHaveLength(1);

    await reused.commit?.({ tx: 'save-2' });
    await disabled.commit?.({ tx: 'save-3' });
    expect(f.log.slice(2)).toEqual([
      { op: 'add', within: 'save-2', statuses: ['ok'] },
      { op: 'add', within: 'save-3', statuses: ['skipped'] },
    ]);
  });
});
