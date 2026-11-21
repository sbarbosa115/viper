import { beforeEach, describe, expect, test } from 'vitest';
import { InMemoryEmailSender } from '../../../../shared/infrastructure/email/in-memory-email-sender.js';
import type { TicketMessage } from '../../domain/index.js';
import type { SupportRun } from '../../ports.js';
import { InMemorySupportStore } from '../../test/in-memory-support.js';
import { BUSINESS_A, NOW, RUN_ID, aTicket, members } from '../../test/factories.js';
import { SendSupportEmail, type SupportEmailDeps, type SupportEmailMessage } from './index.js';

const APP = 'https://app.llyner.test/';
const staff = [members.staff1, members.staff2].map((m) => ({
  memberId: m.id,
  email: m.email,
  name: m.name,
}));
const run: SupportRun = {
  id: RUN_ID,
  planId: 'p1',
  planName: 'Bakeries & cafés',
  startedAt: NOW.toISOString(),
  status: 'failed',
  stoppedStep: null,
  creditsCharged: 0,
  businessId: BUSINESS_A,
  attempt: 1,
  lastError: null,
};

let store: InMemorySupportStore;
let email: InMemoryEmailSender;
let gone: Set<string>;
let revoked: Set<string>;
let warnings: object[];

function deps(sender: SupportEmailDeps['email'] = email): SupportEmailDeps {
  return {
    store,
    email: sender,
    appUrl: APP,
    logger: { info: () => undefined, warn: (o) => void warnings.push(o), error: () => undefined },
    identity: {
      memberSummaries: (ids) =>
        Promise.resolve(
          Object.values(members)
            .filter((m) => ids.includes(m.id) && !gone.has(m.id))
            .map((m) => (revoked.has(m.id) ? { ...m, isStaff: false } : m)),
        ),
      staffMembers: () => Promise.resolve([]),
      staffRecipients: () => Promise.resolve(staff),
      businessNames: (ids) => Promise.resolve(ids.map((id) => ({ id, name: 'Sweet Supply Co.' }))),
    },
    research: { runForSupport: (id) => Promise.resolve(id === RUN_ID ? run : null) },
  };
}

const handler = (): SendSupportEmail => new SendSupportEmail(deps());

function message(kind: TicketMessage['kind'], body: string, id = 'm1'): TicketMessage {
  return {
    id,
    ticketId: '',
    kind,
    authorMemberId: null,
    body,
    event: null,
    emailed: false,
    createdAt: NOW,
  };
}

async function seed(
  overrides: Parameters<typeof aTicket>[0] = {},
  body = 'Was I charged?',
  kind: TicketMessage['kind'] = 'customer_reply',
) {
  const { number: _n, ...rest } = aTicket(overrides);
  const ticket = await store.tickets.create({
    ticket: rest,
    messages: [{ ...message(kind, body), ticketId: rest.id }],
    events: [],
    facts: [],
  });
  return ticket;
}

const base = (t: { id: string; number: number; assigneeId: string | null }) => ({
  ticketId: t.id,
  ticketNumber: t.number,
  businessId: BUSINESS_A,
  openedByMemberId: members.memberA.id,
  assigneeId: t.assigneeId,
});

const event = (type: SupportEmailMessage['type'], payload: object, eventId = 'e1') =>
  ({ eventId, type, payload, occurredAt: NOW.toISOString() }) as SupportEmailMessage;

beforeEach(() => {
  store = new InMemorySupportStore();
  email = new InMemoryEmailSender();
  gone = new Set();
  revoked = new Set();
  warnings = [];
});

describe('FR-11: ticket emails', () => {
  test('TicketOpened goes to all Staff with the run, category and the escaped message', async () => {
    const t = await seed({ runId: RUN_ID, subject: 'Run stopped' }, '<b>hi</b>\nline two');
    await handler().execute(event('TicketOpened', { ...base(t), messageId: 'm1' }));
    expect(email.sent.map((m) => m.to)).toEqual(staff.map((s) => s.email));
    const m = email.sent[0]!;
    expect(email.sent.every((e) => e.fromName === 'Llyner Leads Support')).toBe(true);
    expect(m.subject).toBe(`[#${t.number}] New ticket · Research run / leads · Sweet Supply Co.`);
    expect(m.text).toContain('Linked run: Bakeries & cafés · FAILED');
    expect(m.text).toContain('From: Jo Kim · Member');
    expect(m.text).toContain(`https://app.llyner.test/app/staff/support/${t.number}`);
    expect(m.html).toContain('Open in the Support desk');
    expect(m.html).toContain('&lt;b&gt;hi&lt;/b&gt;<br>line two');
    expect(m.html).not.toContain('<b>hi</b>');
    expect(m.text).toContain('<b>hi</b>');
  });

  test('CustomerReplied goes to the assignee only; to all Staff when unassigned', async () => {
    const t = await seed({ assigneeId: members.staff1.id, status: 'in_progress' });
    await handler().execute(
      event('CustomerReplied', { ...base(t), messageId: 'm1', status: 'in_progress' }),
    );
    expect(email.sent.map((m) => m.to)).toEqual([members.staff1.email]);
    expect(email.sent[0]!.fromName).toBe('Llyner Leads Support');
    expect(email.sent[0]!.subject).toBe(`[#${t.number}] New reply · Sweet Supply Co.`);
    expect(email.sent[0]!.text).toContain('IN PROGRESS');

    email.sent.length = 0;
    await handler().execute(
      event(
        'CustomerReplied',
        { ...base(t), assigneeId: null, messageId: 'm1', status: 'open' },
        'e2',
      ),
    );
    expect(email.sent.map((m) => m.to)).toEqual(staff.map((s) => s.email));
  });

  test('StaffReplied goes to the opener, says Llyner Leads, and marks the message emailed', async () => {
    const t = await seed({ subject: 'My run failed' }, 'We resumed it.', 'staff_reply');
    await handler().execute(event('StaffReplied', { ...base(t), messageId: 'm1' }));
    expect(email.sent).toHaveLength(1);
    const m = email.sent[0]!;
    expect(m.to).toBe(members.memberA.email);
    expect(m.fromName).toBe('Llyner Leads Support');
    expect(m.subject).toBe(`[#${t.number}] New reply: My run failed`);
    expect(m.text).toContain('We replied to your ticket');
    expect(m.text).toContain("Replies to this email aren't read.");
    expect(m.text).toContain(`https://app.llyner.test/app/support/${t.number}`);
    expect(m.html).toContain('Open the ticket');
    expect(`${m.text}${m.html}${m.subject}`).not.toMatch(/viper/i);
    expect((await store.read.findMessage('m1'))?.emailed).toBe(true);
  });

  test('TicketClosed by staff emails the opener with the closing reply; by customer sends nothing', async () => {
    const t = await seed({ subject: 'My run failed' }, 'All sorted.', 'staff_reply');
    const payload = { ...base(t), messageId: 'm1' };
    await handler().execute(event('TicketClosed', { ...payload, closedBy: 'customer' }));
    expect(email.sent).toEqual([]);
    await handler().execute(event('TicketClosed', { ...payload, closedBy: 'staff' }, 'e2'));
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.fromName).toBe('Llyner Leads Support');
    expect(email.sent[0]!.subject).toBe(`[#${t.number}] Closed: My run failed`);
    expect(email.sent[0]!.text).toContain(
      "We've closed this ticket. Reply within 30 days to reopen it.",
    );
    expect(email.sent[0]!.text).toContain('All sorted.');
  });

  test('TicketClosed without a closing reply still emails the opener', async () => {
    const t = await seed();
    await handler().execute(
      event('TicketClosed', { ...base(t), messageId: null, closedBy: 'staff' }),
    );
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.text).not.toContain('Was I charged?');
  });

  test('NFR-4: a retry skips recipients already emailed, and an emailed reply is not sent again', async () => {
    const t = await seed({}, 'Hello', 'staff_reply');
    let delivered: readonly string[] = [];
    const progress = {
      get delivered() {
        return delivered;
      },
      save: (d: readonly string[]) => {
        delivered = d;
        return Promise.resolve();
      },
    };
    const opened = event('TicketOpened', { ...base(t), messageId: 'm1' });
    await handler().execute(opened, progress);
    await handler().execute(opened, progress);
    expect(email.sent).toHaveLength(2);

    email.sent.length = 0;
    const replied = event('StaffReplied', { ...base(t), messageId: 'm1' }, 'e2');
    await handler().execute(replied);
    await handler().execute(replied);
    expect(email.sent).toHaveLength(1);
  });

  test('a failed send throws so the job retries, resuming at the failed recipient', async () => {
    const t = await seed();
    let calls = 0;
    const flaky = {
      send: (m: Parameters<InMemoryEmailSender['send']>[0]) => {
        if (++calls === 2) return Promise.reject(new Error('smtp down'));
        return email.send(m);
      },
    };
    const h = new SendSupportEmail(deps(flaky));
    let delivered: readonly string[] = [];
    const progress = {
      get delivered() {
        return delivered;
      },
      save: (d: readonly string[]) => {
        delivered = d;
        return Promise.resolve();
      },
    };
    const opened = event('TicketOpened', { ...base(t), messageId: 'm1' });
    await expect(h.execute(opened, progress)).rejects.toThrow('smtp down');
    await h.execute(opened, progress);
    expect(email.sent.map((m) => m.to)).toEqual(staff.map((s) => s.email));
  });

  test('skips and logs when the recipient member no longer exists', async () => {
    const t = await seed({ assigneeId: members.staff1.id }, 'Hi', 'staff_reply');
    gone.add(members.memberA.id);
    await handler().execute(event('StaffReplied', { ...base(t), messageId: 'm1' }));
    expect(email.sent).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  test('skips and logs when the Ticket is gone', async () => {
    await handler().execute(
      event('TicketOpened', { ...base({ id: 'x', number: 1, assigneeId: null }), messageId: 'm1' }),
    );
    expect(email.sent).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  test('a reply for an assignee who is gone or no longer Staff goes to all Staff, with a warning', async () => {
    const t = await seed({ assigneeId: members.staff1.id });
    const payload = { ...base(t), messageId: 'm1', status: 'open' };
    gone.add(members.staff1.id);
    await handler().execute(event('CustomerReplied', payload, 'e1'));
    expect(email.sent.map((m) => m.to)).toEqual(staff.map((s) => s.email));
    expect(warnings).toHaveLength(1);

    email.sent.length = 0;
    gone.clear();
    revoked.add(members.staff1.id);
    await handler().execute(event('CustomerReplied', payload, 'e2'));
    expect(email.sent.map((m) => m.to)).toEqual(staff.map((s) => s.email));
    expect(warnings).toHaveLength(2);
  });

  test('the New reply email shows the status from the event, not the Ticket now', async () => {
    const t = await seed({ status: 'closed' });
    await handler().execute(
      event('CustomerReplied', { ...base(t), assigneeId: null, messageId: 'm1', status: 'open' }),
    );
    expect(email.sent[0]!.text).toContain('· OPEN');
    expect(email.sent[0]!.text).not.toContain('CLOSED');
  });
});
