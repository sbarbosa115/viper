import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { appOrigin, demoPassword, expect } from './fixtures.js';
import { uniqueSuffix } from './journeys.js';

/** Shared steps of the support journeys (prd-support section 6a). */

const baseURL = (): string => process.env.BASE_URL ?? 'http://localhost:5173';

export const staffInbox = 'staff@demo.test';

/** A subject no other spec shares, so a journey never depends on another one's tickets. */
export const uniqueSubject = (label: string): string => `${label} ${uniqueSuffix()}`;

/** A Member's API session of its own (password only), for setup and cleanup. Dispose when done. */
export async function memberApi(email: string): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({
    baseURL: baseURL(),
    extraHTTPHeaders: { Origin: appOrigin() },
  });
  const login = await api.post('/api/auth/login', { data: { email, password: demoPassword } });
  expect(login.ok(), `login ${email}: ${login.status()}`).toBe(true);
  return api;
}

/** Opens a Ticket through the API; returns its number. */
export async function createTicket(
  api: APIRequestContext,
  body: { subject: string; message?: string; category?: string; runId?: string },
): Promise<number> {
  const res = await api.post('/api/support/tickets', {
    data: {
      category: 'other',
      message: 'Setup message for an acceptance journey.',
      ...body,
    },
  });
  expect(res.ok(), `create ticket: ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { number: number }).number;
}

/** Closes a Ticket as its opener (no email); a Ticket already closed is fine. */
export async function closeTicket(api: APIRequestContext, number: number): Promise<void> {
  const res = await api.post(`/api/support/tickets/${number}/close`, { data: {} });
  expect([200, 404, 409], `close #${number}: ${res.status()}`).toContain(res.status());
}

/** The seeded failed run of "Bakeries near Austin", as the run picker lists it. */
export async function failedRunId(api: APIRequestContext): Promise<string> {
  const res = await api.get('/api/support/runs');
  expect(res.ok()).toBe(true);
  const { items } = (await res.json()) as {
    items: { id: string; planName: string; status: string }[];
  };
  const run = items.find((r) => r.status === 'failed' && r.planName === 'Bakeries near Austin');
  if (!run) throw new Error('no failed run of "Bakeries near Austin" in the seed');
  return run.id;
}

export interface MailSummary {
  ID: string;
  Subject: string;
  From: { Name: string; Address: string };
}

/** Emails to `to` whose subject carries `[#number]`, newest first. */
export async function ticketEmails(
  mailpitUrl: string,
  to: string,
  number: number,
): Promise<MailSummary[]> {
  const res = await fetch(
    `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=500`,
  );
  const { messages } = (await res.json()) as { messages: MailSummary[] };
  return messages.filter((m) => m.Subject.includes(`[#${number}]`));
}

/** Waits for the first email to `to` about the Ticket whose subject contains `part`. */
export async function waitForTicketEmail(
  mailpitUrl: string,
  to: string,
  number: number,
  part: string,
): Promise<{ summary: MailSummary; text: string }> {
  let found: MailSummary | undefined;
  await expect
    .poll(
      async () => {
        found = (await ticketEmails(mailpitUrl, to, number)).find((m) => m.Subject.includes(part));
        return found !== undefined;
      },
      { message: `email "[#${number}] ${part}" to ${to}`, timeout: 60_000 },
    )
    .toBe(true);
  if (!found) throw new Error('unreachable');
  const msg = (await (await fetch(`${mailpitUrl}/api/v1/message/${found.ID}`)).json()) as {
    Text: string;
  };
  return { summary: found, text: msg.Text };
}

/** The ticket number in "Ticket #1042 sent." */
export function numberFromThreadUrl(url: string): number {
  const match = /\/app\/support\/(\d+)$/.exec(new URL(url).pathname);
  if (!match?.[1]) throw new Error(`not a ticket thread url: ${url}`);
  return Number(match[1]);
}
