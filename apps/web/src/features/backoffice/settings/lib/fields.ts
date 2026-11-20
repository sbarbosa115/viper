import type { SettingsSection, SettingsTestTarget } from '@app/contracts/platform';

export type FieldKind = 'text' | 'email' | 'number' | 'select' | 'switch' | 'secret';

export interface FieldDef {
  /** Path inside the section's body, e.g. `apify.apiKey`. */
  path: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  /** Empty input is saved as null. */
  nullable?: boolean;
  options?: { value: string; label: string }[];
  /** Secrets only: the Test button for this key. */
  testTarget?: SettingsTestTarget;
  inputMode?: 'numeric' | 'decimal';
}

const key = (path: string, label: string, testTarget?: SettingsTestTarget): FieldDef => ({
  path,
  label,
  kind: 'secret',
  ...(testTarget ? { testTarget } : {}),
});

export const sectionFields: Record<SettingsSection, FieldDef[]> = {
  ai: [
    key('anthropicApiKey', 'Anthropic API key', 'anthropic'),
    { path: 'planningModel', label: 'Planning and scoring model', kind: 'text' },
    { path: 'chatModel', label: 'Chat model', kind: 'text' },
    { path: 'fastModel', label: 'Fast model (extraction, websites)', kind: 'text' },
  ],
  providers: [
    key('apify.apiKey', 'Apify', 'apify'),
    key('googleMaps.apiKey', 'Google Maps Platform', 'googleMaps'),
    key('firecrawl.apiKey', 'Firecrawl', 'firecrawl'),
    key('apollo.apiKey', 'Apollo', 'apollo'),
    key('hunter.apiKey', 'Hunter', 'hunter'),
    key('zerobounce.apiKey', 'ZeroBounce', 'zerobounce'),
    { path: 'twilio.accountSid', label: 'Twilio account SID', kind: 'text', nullable: true },
    key('twilio.authToken', 'Twilio auth token', 'twilio'),
  ],
  email: [
    { path: 'host', label: 'Host', kind: 'text', nullable: true },
    { path: 'port', label: 'Port', kind: 'number', inputMode: 'numeric' },
    { path: 'username', label: 'Username', kind: 'text', nullable: true },
    key('password', 'Password'),
    {
      path: 'tls',
      label: 'TLS',
      kind: 'select',
      options: [
        { value: 'starttls', label: 'STARTTLS' },
        { value: 'tls', label: 'TLS' },
        { value: 'none', label: 'None' },
      ],
    },
    { path: 'fromName', label: 'From name', kind: 'text' },
    { path: 'fromAddress', label: 'From address', kind: 'email', nullable: true },
    { path: 'replyTo', label: 'Reply-to', kind: 'email', nullable: true },
  ],
  stripe: [
    key('secretKey', 'Secret key', 'stripe'),
    key('webhookSecret', 'Webhook secret'),
    { path: 'taxEnabled', label: 'Stripe Tax (collect sales tax at checkout)', kind: 'switch' },
  ],
  analytics: [
    {
      path: 'gaMeasurementId',
      label: 'Google Analytics measurement ID',
      kind: 'text',
      nullable: true,
      hint: 'Page views only. Empty = Google Analytics off.',
    },
  ],
  landing: [
    {
      path: 'youtubeVideoId',
      label: 'YouTube video ID',
      kind: 'text',
      nullable: true,
      hint: 'Shows on the landing page within 5 minutes. Empty = no video section.',
    },
  ],
  ceilings: [
    { path: 'maxCredits', label: 'Max credits per run', kind: 'number', inputMode: 'numeric' },
    { path: 'maxLeads', label: 'Max leads per run', kind: 'number', inputMode: 'numeric' },
    { path: 'maxActiveMinutes', label: 'Max active minutes', kind: 'number', inputMode: 'numeric' },
    {
      path: 'maxTotalHours',
      label: 'Max total hours (including retries)',
      kind: 'number',
      inputMode: 'decimal',
    },
    { path: 'maxAttempts', label: 'Max attempts', kind: 'number', inputMode: 'numeric' },
    { path: 'trialCredits', label: 'Trial credits', kind: 'number', inputMode: 'numeric' },
  ],
  support: [
    {
      path: 'supportEmail',
      label: 'Support email',
      kind: 'email',
      nullable: true,
      hint: 'Shown on the legal pages and in emails. Failed runs are reported here.',
    },
  ],
};

/** A secret as the form holds it: undefined keeps it, a string replaces it, "" clears it. */
export type FieldValue = string | boolean | undefined;
export type FormValues = Record<string, FieldValue>;

export function getPath(source: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      source,
    );
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    node = (next ?? (node[part] = {})) as Record<string, unknown>;
  }
  node[parts[parts.length - 1] ?? path] = value;
}

/** Form values from a section as GET returns it; secrets start untouched. */
export function initialValues(fields: FieldDef[], data: unknown): FormValues {
  const values: FormValues = {};
  for (const f of fields) {
    const current = getPath(data, f.path);
    if (f.kind === 'secret') values[f.path] = undefined;
    else if (f.kind === 'switch') values[f.path] = current === true;
    else
      values[f.path] =
        typeof current === 'string' || typeof current === 'number' ? String(current) : '';
  }
  return values;
}

/** The PUT body for a section: numbers parsed, blank nullable text as null, untouched secrets omitted. */
export function buildBody(fields: FieldDef[], values: FormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.path];
    if (f.kind === 'secret') {
      if (typeof v === 'string') setPath(body, f.path, v);
    } else if (f.kind === 'switch') {
      setPath(body, f.path, v === true);
    } else if (f.kind === 'number') {
      const text = typeof v === 'string' ? v.trim() : '';
      setPath(body, f.path, text === '' ? undefined : Number(text));
    } else {
      const text = typeof v === 'string' ? v.trim() : '';
      setPath(body, f.path, text === '' && f.nullable ? null : text);
    }
  }
  // Secret-only parents (apify: { apiKey }) must exist even when every key is untouched.
  for (const f of fields) {
    const parent = f.path.split('.').slice(0, -1).join('.');
    if (parent && getPath(body, parent) === undefined) setPath(body, parent, {});
  }
  return body;
}
