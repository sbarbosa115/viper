import { createHmac, randomInt } from 'node:crypto';
import { request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import {
  appOrigin,
  availableCredits,
  completeFakeCheckout,
  demoPassword,
  expect,
  fetchVerificationLink,
} from './fixtures.js';

/** Shared steps of the journeys that need a customer with a profile, a Plan, or Staff. */

/** The seeded Staff account and its TOTP secret (PRD section 8a). */
export const staffEmail = 'staff@demo.test';
export const staffTotpSecret = 'JBSWY3DPEHPK3PXP';

/** The quick reply AJ-1 ends with and AJ-2 starts from. */
export const bakeriesGoal = 'Bakeries within 3 miles that could buy our cane sugar';

const baseURL = (): string => process.env.BASE_URL ?? 'http://localhost:5173';

export function uniqueSuffix(): string {
  return `${Date.now()}-${randomInt(1_000_000)}`;
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of input.replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error(`not base32: ${c}`);
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as an authenticator app shows it. */
export function totp(secret = staffTotpSecret, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

let lastTotpStep = -1;

/**
 * A TOTP code this process has not used yet. The api refuses a code it already accepted (replay
 * protection), so a second Staff sign-in in the same 30 s window waits for the next code, as a
 * person would.
 */
export async function freshTotp(): Promise<string> {
  const step = () => Math.floor(Date.now() / 30_000);
  if (step() <= lastTotpStep) {
    await new Promise((resolve) =>
      setTimeout(resolve, (lastTotpStep + 1) * 30_000 - Date.now() + 50),
    );
  }
  lastTotpStep = step();
  return totp();
}

/** Staff log in through the form and enter the TOTP code (FR-3, FR-5). Lands on /app/staff. */
export async function loginAsStaff(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(staffEmail);
  await page.getByLabel('Password').fill(demoPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app\/login\/two-factor/);
  await expect(page.getByRole('heading', { name: 'Enter your two-factor code' })).toBeVisible();
  // Typing the whole code into the first box fills all six.
  await page.getByLabel('Digit 1').fill(await freshTotp());
  await page.getByRole('button', { name: 'Verify' }).click();
  const wrong = page.getByText('That code is not right');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 }).or(wrong)).toBeVisible();
  if (await wrong.isVisible()) {
    // This window's code was already used by another process (a retried worker): take the next.
    await page.getByLabel('Digit 1').fill(await freshTotp());
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page).toHaveURL(/\/app\/staff\/?$/);
}

/**
 * A Staff API session of its own (password, then TOTP), for setup and checks that are not part of
 * the journey under test. Dispose it when done.
 */
export async function staffApi(): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({
    baseURL: baseURL(),
    extraHTTPHeaders: { Origin: appOrigin() },
  });
  const login = await api.post('/api/auth/login', {
    data: { email: staffEmail, password: demoPassword },
  });
  expect(login.ok(), `staff login: ${login.status()}`).toBe(true);
  const verifyCode = async () =>
    api.post('/api/auth/two-factor/verify', { data: { code: await freshTotp() } });
  let verify = await verifyCode();
  // Code already used in this window by another process: take the next one.
  if (verify.status() === 401) verify = await verifyCode();
  expect(verify.ok(), `staff two-factor: ${verify.status()}`).toBe(true);
  return api;
}

/** Sets an error mode on a fake Tool (test hook; e2e and dev only). */
export async function setFakeTool(
  request: APIRequestContext,
  body:
    | { mode: 'failAlways' | 'heal'; toolKey: string }
    | { mode: 'failNext'; toolKey: string; n: number }
    | { mode: 'reset' },
): Promise<void> {
  const res = await request.post('/api/test/tools/fail', {
    data: body,
    headers: { Origin: appOrigin() },
  });
  expect(res.ok(), `fake tool ${JSON.stringify(body)}: ${res.status()}`).toBe(true);
}

/** Makes the next attempt to reach `stepKey` stop after `items` work items, as if it crashed. */
export async function stopWorkerAfter(
  request: APIRequestContext,
  stepKey: string,
  items: number,
): Promise<void> {
  const res = await request.post('/api/test/research/stop-after', {
    data: { stepKey, items },
    headers: { Origin: appOrigin() },
  });
  expect(res.status(), 'stop-after hook').toBe(204);
}

interface MailpitSummary {
  ID: string;
  Subject: string;
}

/** Waits for an email to `to` whose subject contains `subject`; returns its text. */
export async function waitForEmail(
  mailpitUrl: string,
  to: string,
  subject: string,
  timeout = 60_000,
): Promise<{ subject: string; text: string }> {
  let found: MailpitSummary | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
        );
        const { messages } = (await res.json()) as { messages: MailpitSummary[] };
        found = messages.find((m) => m.Subject.includes(subject));
        return found !== undefined;
      },
      { message: `email "${subject}" to ${to}`, timeout },
    )
    .toBe(true);
  const msg = (await (await fetch(`${mailpitUrl}/api/v1/message/${found?.ID ?? ''}`)).json()) as {
    Subject: string;
    Text: string;
  };
  return { subject: msg.Subject, text: msg.Text };
}

export interface Customer {
  email: string;
  businessName: string;
}

/**
 * AJ-1 up to the verified welcome chat: a new Business, its Owner, the verified email and the 50
 * trial credits. Each customer gets its own client address so the sign-up limit per IP (FR-1,
 * 5 an hour) never trips across journeys and repeats.
 */
export async function signUpVerified(page: Page, mailpitUrl: string): Promise<Customer> {
  const suffix = uniqueSuffix();
  const email = `sam-${suffix}@journeys.test`;
  const businessName = `Sweet Supply Co ${suffix}`;
  await page.setExtraHTTPHeaders({
    'X-Forwarded-For': `10.${randomInt(256)}.${randomInt(256)}.${1 + randomInt(254)}`,
  });
  await page.goto('/app/signup');
  await page.getByLabel('Business name').fill(businessName);
  await page.getByLabel('Your name').fill('Sam');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Honey-Bun-4-Breakfast!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 20_000 });

  await page.goto(await fetchVerificationLink(mailpitUrl, email));
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  await expect.poll(() => availableCredits(page), { timeout: 30_000 }).toBe(50);
  return { email, businessName };
}

/** AJ-1 steps 4-5: answers the welcome chat until it asks "Who would you like to find?". */
export async function describeBusiness(page: Page): Promise<void> {
  await page.goto('/app/chat');
  const thread = page.getByLabel('Conversation');
  const send = async (answer: string, expectReply: string | RegExp) => {
    await page.getByLabel('Your answer').fill(answer);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(thread).toContainText(expectReply, { timeout: 20_000 });
  };
  await send('We sell cane sugar in 50 lb bags and powdered sugar', /where|located|address/i);
  await send('1200 E 6th St, Austin', /far|radius|deliver|confirm/i);
  await send('3 miles', /who|customers|buy/i);
  await send('restaurants', 'Who would you like to find?');
}

/** AJ-3 as setup: buys the Starter pack through the fake Checkout (+2,500 credits). */
export async function buyStarterPack(page: Page): Promise<void> {
  await page.goto('/app/credits');
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  const before = await availableCredits(page);
  await page.getByRole('button', { name: 'Buy Starter' }).click();
  await page.waitForURL(/\/app\/credits\?purchase=success&fake_session=/);
  const sessionId = new URL(page.url()).searchParams.get('fake_session') ?? '';
  await completeFakeCheckout(page.request, sessionId);
  await expect.poll(() => availableCredits(page), { timeout: 30_000 }).toBe(before + 2500);
}

/** Opens the welcome chat at its end and clicks the goal quick reply; lands on the new Plan. */
export async function pickBakeriesGoal(page: Page): Promise<string> {
  await page.goto('/app/chat');
  await page.getByRole('button', { name: bakeriesGoal }).click();
  await expect(page).toHaveURL(/\/app\/plans\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

/**
 * A customer ready to research: signed up and verified, profile described, `credits` topped up by
 * a Starter pack when asked, and the Bakeries Plan open. Returns the customer and the Plan id.
 */
export async function customerWithPlan(
  page: Page,
  mailpitUrl: string,
  options: { buyStarter: boolean },
): Promise<Customer & { planId: string }> {
  const customer = await signUpVerified(page, mailpitUrl);
  await describeBusiness(page);
  if (options.buyStarter) await buyStarterPack(page);
  const planId = await pickBakeriesGoal(page);
  return { ...customer, planId };
}

/** The signed-in Member's Business id. */
export async function businessIdOf(page: Page): Promise<string> {
  const res = await page.request.get('/api/auth/me');
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { business: { id: string } }).business.id;
}

/** Reads a run as the customer sees it. */
export async function readRun(
  page: Page,
  runId: string,
): Promise<{
  status: string;
  creditsSpent: number;
  creditsReserved: number;
  leadsDelivered: number;
}> {
  const res = await page.request.get(`/api/runs/${runId}`);
  expect(res.ok(), `GET run ${runId}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as {
    status: string;
    creditsSpent: number;
    creditsReserved: number;
    leadsDelivered: number;
  };
}

/** The wallet as the customer's API reports it. */
export async function wallet(
  page: Page,
): Promise<{ available: number; reserved: number; balance: number }> {
  const res = await page.request.get('/api/credits');
  expect(res.ok()).toBe(true);
  return (await res.json()) as { available: number; reserved: number; balance: number };
}

export const runIdFromUrl = (page: Page): string =>
  new URL(page.url()).pathname.split('/').pop() ?? '';
