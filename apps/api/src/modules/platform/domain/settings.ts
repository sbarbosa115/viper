/**
 * Platform settings (FR-8, ADR 0012): eight sections of plain values plus write-only secrets.
 * Pure rules: defaults, which fields are secrets, how a save changes a section, how secrets are
 * shown. Encryption and storage live outside the domain.
 */

export const SETTINGS_SECTIONS = [
  'ai',
  'providers',
  'email',
  'stripe',
  'analytics',
  'ceilings',
  'landing',
  'support',
] as const;
export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number];

export type PlainValue = string | number | boolean | null | PlainValues;
export interface PlainValues {
  readonly [key: string]: PlainValue;
}

export const PROVIDER_KEYS = [
  'apify',
  'googleMaps',
  'firecrawl',
  'apollo',
  'hunter',
  'zerobounce',
  'twilio',
] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

/** Secret fields per section, as dot paths inside the section. */
export const SECRET_FIELDS: Readonly<Record<SettingsSectionKey, readonly string[]>> = {
  ai: ['anthropicApiKey'],
  providers: [
    'apify.apiKey',
    'googleMaps.apiKey',
    'firecrawl.apiKey',
    'apollo.apiKey',
    'hunter.apiKey',
    'zerobounce.apiKey',
    'twilio.authToken',
  ],
  email: ['password'],
  stripe: ['secretKey', 'webhookSecret'],
  analytics: [],
  ceilings: [],
  landing: [],
  support: [],
};

export const DEFAULT_MODELS = {
  planningModel: 'claude-opus-5-5',
  chatModel: 'claude-sonnet-5-5',
  fastModel: 'claude-haiku-5-5',
} as const;

export const DEFAULT_CEILINGS = {
  maxCredits: 1_000,
  maxLeads: 500,
  maxActiveMinutes: 120,
  maxTotalHours: 4,
  maxAttempts: 5,
  trialCredits: 50,
} as const;

/** Plain (non-secret) defaults per section, used until Staff save the section. */
export const SECTION_DEFAULTS: Readonly<Record<SettingsSectionKey, PlainValues>> = {
  ai: { ...DEFAULT_MODELS },
  providers: {
    apify: {},
    googleMaps: {},
    firecrawl: {},
    apollo: {},
    hunter: {},
    zerobounce: {},
    twilio: { accountSid: null },
  },
  email: {
    host: null,
    port: 2525,
    username: null,
    tls: 'starttls',
    fromName: 'Llyner Leads',
    fromAddress: null,
    replyTo: null,
  },
  stripe: { taxEnabled: true },
  analytics: { gaMeasurementId: null },
  ceilings: { ...DEFAULT_CEILINGS },
  landing: { youtubeVideoId: null },
  support: { supportEmail: null },
};

/** One secret as stored: AES-256-GCM output plus the non-secret hint shown to Staff. */
export interface SealedSecret {
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
  readonly last4: string | null;
  readonly updatedAt: Date;
}

export interface StoredSection {
  readonly section: SettingsSectionKey;
  readonly values: PlainValues;
  /** Keyed by dot path, e.g. `twilio.authToken`. */
  readonly secrets: Readonly<Record<string, SealedSecret>>;
  readonly updatedBy: string | null;
  readonly updatedAt: Date | null;
}

/** A secret as the API shows it: never the value. */
export interface MaskedSecret {
  readonly set: boolean;
  readonly last4: string | null;
  readonly updatedAt: string | null;
}

export interface SecretChange {
  readonly path: string;
  /** The new value, or null to clear it. */
  readonly value: string | null;
}

export interface SectionUpdatePlan {
  /** The section's plain values after the save. */
  readonly values: PlainValues;
  readonly secretChanges: readonly SecretChange[];
  /** Changed field paths for the Audit log: names only, never values. */
  readonly changedFields: readonly string[];
}

/** Secrets shorter than this show no hint at all, so the hint never reveals most of a value. */
const MIN_LENGTH_FOR_HINT = 8;

export function last4Of(value: string): string | null {
  return value.length >= MIN_LENGTH_FOR_HINT ? value.slice(-4) : null;
}

export function maskSecret(secret: SealedSecret | undefined): MaskedSecret {
  if (!secret) return { set: false, last4: null, updatedAt: null };
  return { set: true, last4: secret.last4, updatedAt: secret.updatedAt.toISOString() };
}

export function emptySection(section: SettingsSectionKey): StoredSection {
  return { section, values: {}, secrets: {}, updatedBy: null, updatedAt: null };
}

function isPlainValues(value: PlainValue | undefined): value is PlainValues {
  return typeof value === 'object' && value !== null;
}

/** Stored values laid over the defaults, so fields added later read their default. */
export function withDefaults(section: SettingsSectionKey, values: PlainValues): PlainValues {
  return mergeDeep(SECTION_DEFAULTS[section], values);
}

function mergeDeep(base: PlainValues, over: PlainValues): PlainValues {
  const out: Record<string, PlainValue> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] = isPlainValues(current) && isPlainValues(value) ? mergeDeep(current, value) : value;
  }
  return out;
}

export function getPath(values: PlainValues, path: string): PlainValue | undefined {
  let node: PlainValue | undefined = values;
  for (const key of path.split('.')) {
    if (!isPlainValues(node)) return undefined;
    node = node[key];
  }
  return node;
}

export function setPath(values: PlainValues, path: string, value: PlainValue): PlainValues {
  const [head, ...rest] = path.split('.');
  if (head === undefined) return values;
  if (rest.length === 0) return { ...values, [head]: value };
  const child = values[head];
  return { ...values, [head]: setPath(isPlainValues(child) ? child : {}, rest.join('.'), value) };
}

function withoutPath(values: PlainValues, path: string): PlainValues {
  const [head, ...rest] = path.split('.');
  if (head === undefined || !(head in values)) return values;
  if (rest.length === 0) {
    const copy: Record<string, PlainValue> = { ...values };
    delete copy[head];
    return copy;
  }
  const child = values[head];
  return isPlainValues(child) ? { ...values, [head]: withoutPath(child, rest.join('.')) } : values;
}

/** Leaf paths of a values tree: `{ a: { b: 1 } }` → `['a.b']`. */
function leafPaths(values: PlainValues, prefix = ''): string[] {
  return Object.entries(values).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isPlainValues(value) ? leafPaths(value, path) : [path];
  });
}

/**
 * Applies a save request to a section. Secret fields: a string replaces the secret, `""` clears
 * it, omitted (undefined) keeps it. Plain fields replace the stored values.
 */
export function planSectionUpdate(
  current: StoredSection,
  input: Readonly<Record<string, unknown>>,
): SectionUpdatePlan {
  const secretPaths = SECRET_FIELDS[current.section];
  let values = input as PlainValues;
  const secretChanges: SecretChange[] = [];
  for (const path of secretPaths) {
    const raw = getPath(values, path);
    values = withoutPath(values, path);
    if (typeof raw !== 'string') continue;
    if (raw === '' && !current.secrets[path]) continue;
    secretChanges.push({ path, value: raw === '' ? null : raw });
  }
  values = dropEmptyObjects(values);

  const before = withDefaults(current.section, current.values);
  const after = withDefaults(current.section, values);
  const plainChanged = [...new Set([...leafPaths(before), ...leafPaths(after)])].filter(
    (path) => getPath(before, path) !== getPath(after, path),
  );
  const changedFields = [...plainChanged, ...secretChanges.map((c) => c.path)].sort();
  return { values, secretChanges, changedFields };
}

function dropEmptyObjects(values: PlainValues): PlainValues {
  const out: Record<string, PlainValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (isPlainValues(value)) {
      const inner = dropEmptyObjects(value);
      if (Object.keys(inner).length > 0) out[key] = inner;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** The section as Staff see it: plain values with every secret path replaced by its mask. */
export function presentSection(stored: StoredSection): PlainValues {
  let view = withDefaults(stored.section, stored.values);
  for (const path of SECRET_FIELDS[stored.section]) {
    const masked = maskSecret(stored.secrets[path]);
    view = setPath(view, path, { ...masked });
  }
  return view;
}
