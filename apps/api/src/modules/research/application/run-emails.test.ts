import { describe, expect, test } from 'vitest';
import { TOOL_KEYS } from '../domain/local-buyers.js';
import {
  actingAs,
  BUSINESS,
  owner,
  PLAN,
  researchFixture,
  type ResearchFixture,
} from '../test/research-fixture.js';
import type { RunEventMessage } from './run-emails.js';

function eventFor(f: ResearchFixture, runId: string, eventId = 'evt-1'): RunEventMessage {
  const event = f.store.outbox.find((e) => e.type !== 'RunRequested');
  if (!event) throw new Error('no run event');
  return {
    eventId,
    type: event.type,
    payload: event.payload as RunEventMessage['payload'] & { runId: string },
  };
}

async function completedRun(actor = owner()) {
  const f = await researchFixture();
  const run = await f.runs.start(actor, PLAN);
  await f.runToEnd(run.id);
  return { f, run };
}

async function failedRun(actor = owner()) {
  const f = await researchFixture();
  const run = await f.runs.start(actor, PLAN);
  f.tools.fail(TOOL_KEYS.firecrawl, 1, 'INSUFFICIENT_CREDITS', 'Over budget');
  await f.runToEnd(run.id);
  return { f, run };
}

describe('FR-22: run emails', () => {
  test('RunCompleted emails the Owner exactly once even if the event is delivered twice', async () => {
    const { f, run } = await completedRun();
    const event = eventFor(f, run.id);
    expect(event.type).toBe('RunCompleted');
    await f.emails.handle(event);
    await f.emails.handle(event);
    expect(f.email.sent).toHaveLength(1);
    const s = f.store.run(run.id)?.toSnapshot();
    expect(f.email.sent[0]).toMatchObject({
      to: 'owner@demo.test',
      subject: 'Your leads are ready: Bakeries near Austin',
    });
    expect(f.email.sent[0]?.text).toContain(`${s?.leadsDelivered} leads are ready`);
    expect(f.email.sent[0]?.text).toContain(`Credits spent: ${s?.creditsSpent}`);
    expect(f.email.sent[0]?.text).toContain(`http://localhost:5173/app/plans/${PLAN}/leads`);
  });

  test('RunFailed emails the Owner (credits charged, link to the Plan) and the support address', async () => {
    const { f, run } = await failedRun();
    const event = eventFor(f, run.id);
    expect(event.type).toBe('RunFailed');
    await f.emails.handle(event);
    await f.emails.handle(event);
    expect(f.email.sent.map((m) => [m.to, m.subject])).toEqual([
      ['owner@demo.test', "Your research run didn't finish"],
      ['support@llyner.test', 'Research run failed: Bakeries near Austin (Sweet Supply Co)'],
    ]);
    expect(f.email.sent[0]?.text).toContain('You were charged 0 credits.');
    expect(f.email.sent[0]?.text).toContain(`/app/plans/${PLAN}`);
    expect(f.email.sent[1]?.text).toContain('INSUFFICIENT_CREDITS');
  });

  test('not sent to the customer when Staff started the run while Acting as (support still hears of failures)', async () => {
    const completed = await completedRun(actingAs());
    await completed.f.emails.handle(eventFor(completed.f, completed.run.id));
    expect(completed.f.email.sent).toEqual([]);

    const failed = await failedRun(actingAs());
    await failed.f.emails.handle(eventFor(failed.f, failed.run.id));
    expect(failed.f.email.sent.map((m) => m.to)).toEqual(['support@llyner.test']);
  });

  test('a failed send is retried by the queue: the claim is given back', async () => {
    const { f, run } = await completedRun();
    const event = eventFor(f, run.id);
    const send = f.email.send.bind(f.email);
    let fail = true;
    f.email.send = (m) => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error('SMTP down'));
      }
      return send(m);
    };
    await expect(f.emails.handle(event)).rejects.toThrow('SMTP down');
    await f.emails.handle(event);
    expect(f.email.sent).toHaveLength(1);
  });

  test('RunCancelled sends nothing; no support address, no support email', async () => {
    const f = await researchFixture();
    const run = await f.runs.start(owner(), PLAN);
    await f.runs.cancel(owner(), run.id);
    await f.emails.handle(eventFor(f, run.id));
    expect(f.email.sent).toEqual([]);

    const failed = await failedRun();
    failed.f.settings.supportEmail = null;
    await failed.f.emails.handle(eventFor(failed.f, failed.run.id));
    expect(failed.f.email.sent.map((m) => m.to)).toEqual(['owner@demo.test']);
    expect(BUSINESS).toBeTruthy();
  });
});
