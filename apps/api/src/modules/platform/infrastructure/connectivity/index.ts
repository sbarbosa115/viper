import type { EmailSender } from '../../../../shared/application/email-sender.js';
import type { ConnectivityTester } from '../../application/ports.js';
import type { SettingsReader } from '../../application/settings-reader.js';
import { providerCheck, type Fetch } from './provider-checks.js';
import { anthropicCheck, smtpCheck, stripeCheck } from './service-checks.js';

/** The live Settings "Test" adapters, one per target (FR-8). Tests use fakeConnectivityTester. */
export function createConnectivityTester(deps: {
  settings: SettingsReader;
  email: EmailSender;
  fetch?: Fetch;
}): ConnectivityTester {
  const http = { settings: deps.settings, ...(deps.fetch ? { fetch: deps.fetch } : {}) };
  return {
    anthropic: anthropicCheck({ settings: deps.settings }),
    apify: providerCheck('apify', http),
    googleMaps: providerCheck('googleMaps', http),
    firecrawl: providerCheck('firecrawl', http),
    apollo: providerCheck('apollo', http),
    hunter: providerCheck('hunter', http),
    zerobounce: providerCheck('zerobounce', http),
    twilio: providerCheck('twilio', http),
    smtp: smtpCheck({ settings: deps.settings, email: deps.email }),
    stripe: stripeCheck({ settings: deps.settings }),
  };
}
