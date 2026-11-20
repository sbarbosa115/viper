import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from '../../../shared/application/email-sender.js';
import type { EmailSettings, SettingsReader } from '../application/settings-reader.js';

/** Thrown when Platform settings lack an SMTP host or from address. */
export class EmailNotConfiguredError extends Error {
  readonly code = 'EMAIL_NOT_CONFIGURED';
  constructor() {
    super('Email is not configured: set the SMTP host and from address in Platform settings');
  }
}

const TIMEOUT_MS = 15_000;

function transportOptions(s: EmailSettings & { host: string }) {
  return {
    host: s.host,
    port: s.port,
    // `tls`: TLS from the first byte (465); `starttls`: upgrade required; `none`: plain (Mailpit).
    secure: s.tls === 'tls',
    requireTLS: s.tls === 'starttls',
    ignoreTLS: s.tls === 'none',
    auth: s.username ? { user: s.username, pass: s.password ?? '' } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
    logger: false,
    debug: false,
  };
}

/**
 * EmailSender over SMTP (ADR 0013). Host, port, credentials, TLS mode and sender come from
 * Platform settings at send time, so a change in the back office applies within 60 s.
 * Credentials are never logged.
 */
export class SmtpEmailSender implements EmailSender {
  private transport: { key: string; transporter: Transporter } | null = null;

  constructor(private readonly deps: { settings: SettingsReader }) {}

  async send(message: EmailMessage): Promise<void> {
    const settings = await this.deps.settings.email();
    const { host, fromAddress } = settings;
    if (!host || !fromAddress) throw new EmailNotConfiguredError();
    await this.transporterFor({ ...settings, host }).sendMail({
      from: { name: settings.fromName, address: fromAddress },
      ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }

  private transporterFor(settings: EmailSettings & { host: string }): Transporter {
    const key = JSON.stringify(transportOptions(settings));
    if (this.transport?.key !== key) {
      this.transport?.transporter.close();
      this.transport = { key, transporter: createTransport(transportOptions(settings)) };
    }
    return this.transport.transporter;
  }

  close(): void {
    this.transport?.transporter.close();
    this.transport = null;
  }
}
