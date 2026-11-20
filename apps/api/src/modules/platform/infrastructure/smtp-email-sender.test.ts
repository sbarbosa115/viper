import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { FakeSmtpServer } from '../test/fake-smtp-server.js';
import { fakeSettingsReader } from '../test/fakes.js';
import { EmailNotConfiguredError, SmtpEmailSender } from './smtp-email-sender.js';

let server: FakeSmtpServer;
let port: number;
let sender: SmtpEmailSender | null = null;

beforeEach(async () => {
  server = new FakeSmtpServer();
  port = await server.start();
});
afterEach(async () => {
  sender?.close();
  sender = null;
  await server.stop();
});

function smtp(overrides: Record<string, string | number | null> = {}) {
  sender = new SmtpEmailSender({
    settings: fakeSettingsReader({
      'email.host': '127.0.0.1',
      'email.port': port,
      'email.tls': 'none',
      'email.fromAddress': 'hello@llyner.test',
      ...overrides,
    }),
  });
  return sender;
}

describe('ADR 0013: SMTP EmailSender', () => {
  test('sends with the from name, from address and reply-to from Platform settings', async () => {
    await smtp({ 'email.replyTo': 'support@llyner.test' }).send({
      to: 'owner@demo.test',
      subject: 'Your leads are ready',
      text: 'Hello',
    });
    expect(server.received).toHaveLength(1);
    const mail = server.received[0];
    expect(mail?.from).toBe('hello@llyner.test');
    expect(mail?.to).toEqual(['owner@demo.test']);
    expect(mail?.data).toContain('From: Llyner Leads <hello@llyner.test>');
    expect(mail?.data).toContain('Reply-To: support@llyner.test');
    expect(mail?.data).toContain('Subject: Your leads are ready');
    expect(mail?.auth).toBeNull();
  });

  test('authenticates with the stored username and password', async () => {
    await smtp({ 'email.username': 'mailer', 'email.password': 'smtp-secret-1' }).send({
      to: 'owner@demo.test',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
    expect(server.received[0]?.auth).toEqual({ user: 'mailer', pass: 'smtp-secret-1' });
    expect(server.received[0]?.data).toContain('<p>Hello</p>');
  });

  test('STARTTLS mode refuses a server that cannot upgrade', async () => {
    await expect(
      smtp({ 'email.tls': 'starttls' }).send({ to: 'a@b.test', subject: 's', text: 't' }),
    ).rejects.toThrow();
    expect(server.received).toHaveLength(0);
  });

  test('without a host or from address it throws EMAIL_NOT_CONFIGURED', async () => {
    await expect(
      smtp({ 'email.host': null }).send({ to: 'a@b.test', subject: 's', text: 't' }),
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
    await expect(
      smtp({ 'email.fromAddress': null }).send({ to: 'a@b.test', subject: 's', text: 't' }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' });
  });
});
