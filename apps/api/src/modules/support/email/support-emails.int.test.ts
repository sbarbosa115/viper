import { describe, expect, test } from 'vitest';
import { SmtpEmailSender } from '../../platform/infrastructure/smtp-email-sender.js';
import { fakeSettingsReader } from '../../platform/test/fakes.js';
import { InMemorySupportStore } from '../test/in-memory-support.js';
import { BUSINESS_A, NOW, aTicket, members } from '../test/factories.js';
import { SendSupportEmail, type SupportEmailMessage } from '../application/notifications/index.js';

const mailpitUrl = process.env.MAILPIT_URL;

describe.skipIf(!mailpitUrl)('FR-11: the support emails reach Mailpit', () => {
  test('a staff reply is delivered to the opener, escaped and from Llyner Leads', async () => {
    const base = mailpitUrl ?? '';
    const to = `jo+${Date.now()}@llyner.test`;
    const store = new InMemorySupportStore();
    const { number: _n, ...rest } = aTicket({ subject: 'My run failed' });
    const ticket = await store.tickets.create({
      ticket: rest,
      events: [],
      facts: [],
      messages: [
        {
          id: 'm1',
          ticketId: rest.id,
          kind: 'staff_reply',
          authorMemberId: members.staff1.id,
          body: 'Resumed <b>now</b>',
          event: null,
          emailed: false,
          createdAt: NOW,
        },
      ],
    });
    const email = new SmtpEmailSender({
      settings: fakeSettingsReader({
        'email.host': new URL(base).hostname,
        'email.port': 1025,
        'email.tls': 'none',
        'email.fromAddress': 'support@llyner.test',
      }),
    });
    try {
      await new SendSupportEmail({
        store,
        email,
        appUrl: 'http://localhost:5173',
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        identity: {
          memberSummaries: () => Promise.resolve([{ ...members.memberA, email: to }]),
          staffMembers: () => Promise.resolve([]),
          staffRecipients: () => Promise.resolve([]),
          businessNames: () => Promise.resolve([{ id: BUSINESS_A, name: 'Sweet Supply Co.' }]),
        },
        research: { runForSupport: () => Promise.resolve(null) },
      }).execute({
        eventId: 'e1',
        type: 'StaffReplied',
        occurredAt: NOW.toISOString(),
        payload: {
          ticketId: ticket.id,
          ticketNumber: ticket.number,
          businessId: BUSINESS_A,
          openedByMemberId: members.memberA.id,
          assigneeId: null,
          messageId: 'm1',
        },
      } satisfies SupportEmailMessage);
    } finally {
      email.close();
    }
    const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const found = (await res.json()) as {
      messages: { ID: string; Subject: string; From: { Name: string } }[];
    };
    expect(found.messages.map((m) => m.Subject)).toEqual([
      `[#${ticket.number}] New reply: My run failed`,
    ]);
    expect(found.messages[0]?.From.Name).toBe('Llyner Leads Support');
    const msg = (await (await fetch(`${base}/api/v1/message/${found.messages[0]!.ID}`)).json()) as {
      Text: string;
      HTML: string;
    };
    expect(msg.HTML).toContain('Open the ticket');
    expect(msg.HTML).toContain('Resumed &lt;b&gt;now&lt;/b&gt;');
    expect(msg.Text).toContain(`http://localhost:5173/app/support/${ticket.number}`);
  });
});
