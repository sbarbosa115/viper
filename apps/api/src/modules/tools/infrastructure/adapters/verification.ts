import type { Clock } from '../../../../shared/domain/clock.js';
import type { ProviderSettings } from '../../application/ports.js';
import { registerAdapter } from './register.js';
import { ToolFailure, type RegisteredAdapter } from '../../application/tool-adapter.js';
import {
  emailCheckInput,
  emailCheckOutput,
  phoneCheckInput,
  phoneCheckOutput,
  type EmailCheckInput,
  type PhoneCheckInput,
  type Verdict,
} from '../tool-io.js';
import { TOOL_KEYS } from '../../domain/tool-keys.js';
import { requestJson, requireKey, type Fetch } from './http.js';

export const ZEROBOUNCE_URL = 'https://api.zerobounce.net/v2/validate';
export const TWILIO_LOOKUP_URL = 'https://lookups.twilio.com/v2/PhoneNumbers';

interface Deps {
  settings: ProviderSettings;
  clock: Clock;
  fetch?: Fetch;
}

type Item = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const obj = (v: unknown): Item => (typeof v === 'object' && v !== null ? (v as Item) : {});

/** ZeroBounce status → verdict: only `valid` is Verified (FR-25). */
export function emailVerdict(status: string): Verdict {
  if (status === 'valid') return 'verified';
  if (['invalid', 'spamtrap', 'abuse', 'do_not_mail'].includes(status)) return 'invalid';
  return 'unknown';
}

/** ZeroBounce validate (1 email). ZeroBounce answers errors with HTTP 200 and `{ error }`. */
export function zeroBounceAdapter(deps: Deps): RegisteredAdapter {
  const fetchFn = deps.fetch ?? fetch;
  return registerAdapter({
    key: TOOL_KEYS.zerobounce,
    requires: 'zerobounce',
    input: emailCheckInput,
    output: emailCheckOutput,
    maxUnits: () => 1,
    async run(input: EmailCheckInput) {
      const apiKey = requireKey((await deps.settings.provider('zerobounce')).apiKey, 'ZeroBounce');
      const url = `${ZEROBOUNCE_URL}?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(input.email)}&ip_address=`;
      const body = obj(await requestJson(fetchFn, 'ZeroBounce', url));
      const error = str(body.error);
      if (error) {
        throw /key|credits/i.test(error)
          ? ToolFailure.notConfigured(`ZeroBounce: ${error.slice(0, 200)}`)
          : ToolFailure.final(`ZeroBounce: ${error.slice(0, 200)}`);
      }
      const status = str(body.status) ?? 'unknown';
      return {
        output: {
          email: str(body.address) ?? input.email,
          status,
          subStatus: str(body.sub_status),
          verdict: emailVerdict(status),
          source: { name: 'ZeroBounce', url: null, retrievedAt: deps.clock.now().toISOString() },
        },
        units: 1,
      };
    },
  });
}

/** A US number in E.164 (`+1` and 10 digits), or the given `+` number; null when it can't be one. */
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+'))
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Twilio Lookup v2 with line type intelligence (1 lookup). Valid numbers are Verified (FR-25). */
export function twilioLookupAdapter(deps: Deps): RegisteredAdapter {
  const fetchFn = deps.fetch ?? fetch;
  return registerAdapter({
    key: TOOL_KEYS.twilioLookup,
    requires: 'twilio',
    input: phoneCheckInput,
    output: phoneCheckOutput,
    maxUnits: () => 1,
    async run(input: PhoneCheckInput) {
      const creds = await deps.settings.provider('twilio');
      const sid = requireKey(creds.accountSid, 'Twilio');
      const token = requireKey(creds.authToken, 'Twilio');
      const retrievedAt = deps.clock.now().toISOString();
      const e164 = toE164(input.phone);
      if (!e164) {
        throw ToolFailure.final('Not a phone number Twilio can look up');
      }
      const url = `${TWILIO_LOOKUP_URL}/${encodeURIComponent(e164)}?Fields=line_type_intelligence`;
      const body = obj(
        await requestJson(fetchFn, 'Twilio', url, {
          headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
        }),
      );
      const valid = body.valid === true;
      const verdict: Verdict = valid ? 'verified' : 'invalid';
      const line = obj(body.line_type_intelligence);
      return {
        output: {
          phoneNumber: str(body.phone_number) ?? e164,
          valid,
          lineType: str(line.type),
          carrier: str(line.carrier_name),
          verdict,
          source: { name: 'Twilio Lookup', url: null, retrievedAt },
        },
        units: 1,
      };
    },
  });
}
