import { describe, expect, test } from 'vitest';
import { fakeSettingsReader } from '../test/fakes.js';
import { smtpCheck, TEST_EMAIL_SUBJECT } from './connectivity/service-checks.js';
import { SmtpEmailSender } from './smtp-email-sender.js';

/**
 * FR-8 acceptance: "Given valid SMTP settings, when Send test email, then Mailpit receives it."
 * Runs when the test stack has Mailpit (MAILPIT_URL, SMTP on port 1025 of the same host).
 */
const mailpitUrl = process.env.MAILPIT_URL;

describe.skipIf(!mailpitUrl)('FR-8: SMTP test email reaches Mailpit', () => {
  test('Send test email delivers "Test email from Llyner Leads"', async () => {
    const base = mailpitUrl ?? '';
    const to = `ops+${Date.now()}@llyner.test`;
    const settings = fakeSettingsReader({
      'email.host': new URL(base).hostname,
      'email.port': 1025,
      'email.tls': 'none',
      'email.fromAddress': 'hello@llyner.test',
    });
    const email = new SmtpEmailSender({ settings });
    try {
      const result = await smtpCheck({ settings, email })({
        to,
        signal: new AbortController().signal,
      });
      expect(result).toEqual({ ok: true, message: `Test email sent to ${to}` });
    } finally {
      email.close();
    }

    const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const body = (await res.json()) as { messages: { Subject: string }[] };
    expect(body.messages.map((m) => m.Subject)).toEqual([TEST_EMAIL_SUBJECT]);
  });
});
