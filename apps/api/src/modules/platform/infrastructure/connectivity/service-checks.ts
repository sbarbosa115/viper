import Anthropic from '@anthropic-ai/sdk';
import Stripe from 'stripe';
import type { EmailSender } from '../../../../shared/application/email-sender.js';
import type { ConnectivityCheck, ConnectivityResult } from '../../application/ports.js';
import type { SettingsReader } from '../../application/settings-reader.js';
import { withoutSecrets } from './provider-checks.js';

const TIMEOUT_MS = 15_000;
const notConfigured = (what: string): ConnectivityResult => ({
  ok: false,
  message: `Not configured: save the ${what} first`,
});

/**
 * Anthropic: looks up each configured model with the key. This proves the key and every model
 * ID without spending tokens; a rejected model ID shows Anthropic's message.
 */
export function anthropicCheck(deps: {
  settings: SettingsReader;
  /** Tests point this at a local server; production uses the SDK default. */
  baseURL?: string;
}): ConnectivityCheck {
  return async ({ signal }) => {
    const ai = await deps.settings.ai();
    if (!ai.anthropicApiKey) return notConfigured('Anthropic API key');
    const client = new Anthropic({
      apiKey: ai.anthropicApiKey,
      maxRetries: 0,
      timeout: TIMEOUT_MS,
      ...(deps.baseURL ? { baseURL: deps.baseURL } : {}),
    });
    const models = [...new Set([ai.planningModel, ai.chatModel, ai.fastModel])];
    try {
      for (const model of models) await client.models.retrieve(model, {}, { signal });
      return { ok: true, message: `Connected. Models available: ${models.join(', ')}` };
    } catch (err) {
      if (signal.aborted) return { ok: false, message: 'Timed out' };
      const message =
        err instanceof Anthropic.APIError
          ? (err.apiMessage ?? `Anthropic answered HTTP ${String(err.status)}`)
          : 'Could not reach Anthropic';
      return withoutSecrets({ ok: false, message }, [ai.anthropicApiKey]);
    }
  };
}

/** Stripe: retrieves the balance with the secret key (FR-8). */
export function stripeCheck(deps: {
  settings: SettingsReader;
  /** Tests point this at a local server; production uses the SDK default. */
  endpoint?: { host: string; port: number; protocol: 'http' | 'https' };
}): ConnectivityCheck {
  return async ({ signal }) => {
    const { secretKey } = await deps.settings.stripe();
    if (!secretKey) return notConfigured('Stripe secret key');
    const stripe = new Stripe(secretKey, {
      maxNetworkRetries: 0,
      timeout: TIMEOUT_MS,
      ...(deps.endpoint ?? {}),
    });
    try {
      const balance = await stripe.balance.retrieve({}, { signal } as Stripe.RequestOptions);
      return { ok: true, message: `Connected (${balance.livemode ? 'live' : 'test'} mode)` };
    } catch (err) {
      if (signal.aborted) return { ok: false, message: 'Timed out' };
      const message =
        err instanceof Stripe.errors.StripeError && err.statusCode
          ? err.message
          : 'Could not reach Stripe';
      return withoutSecrets({ ok: false, message }, [secretKey]);
    }
  };
}

export const TEST_EMAIL_SUBJECT = 'Test email from Llyner Leads';

/** SMTP: sends "Test email from Llyner Leads" to the given address with the saved settings. */
export function smtpCheck(deps: {
  settings: SettingsReader;
  email: EmailSender;
}): ConnectivityCheck {
  return async ({ to }) => {
    if (!to) return { ok: false, message: 'Enter the address to send the test email to' };
    const email = await deps.settings.email();
    if (!email.host || !email.fromAddress) return notConfigured('SMTP host and from address');
    try {
      await deps.email.send({
        to,
        subject: TEST_EMAIL_SUBJECT,
        text: 'Your SMTP settings work: this test email was sent from the Llyner Leads back office.',
      });
      return { ok: true, message: `Test email sent to ${to}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send the test email';
      return withoutSecrets({ ok: false, message: message.slice(0, 300) }, [
        email.password,
        email.username,
      ]);
    }
  };
}
