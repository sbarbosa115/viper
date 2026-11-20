import { ValidationError } from '../../../shared/domain/errors.js';
import {
  clip,
  contactKey,
  distanceMeters,
  domainOf,
  normaliseName,
  normalisePhone,
} from './normalise.js';

export type ContactType =
  'phone' | 'email' | 'website' | 'instagram' | 'tiktok' | 'yelp' | 'facebook';
export const CONTACT_TYPES: readonly ContactType[] = [
  'phone',
  'email',
  'website',
  'instagram',
  'tiktok',
  'yelp',
  'facebook',
];

/**
 * A Contact's check result: `verified` (ZeroBounce `valid`, Twilio valid number), `unverified`
 * (not checked, or the check was inconclusive) or `invalid` (dropped at delivery, FR-25).
 */
export type Verification = 'verified' | 'unverified' | 'invalid';

/** Where a fact came from and when (ISO 8601 UTC). */
export interface SourceRef {
  readonly name: string;
  readonly url: string | null;
  readonly retrievedAt: string;
}

export interface ProspectContact {
  readonly type: ContactType;
  readonly value: string;
  readonly label: string | null;
  readonly verification: Verification;
  readonly source: SourceRef;
}

export interface EvidenceItem {
  readonly fact: string;
  readonly points: number;
  readonly source: SourceRef;
}

export interface Pitch {
  readonly productId: string | null;
  readonly productName: string;
  readonly reason: string;
}

/** What the Websites step read (FR-19 Step 5). */
export interface WebsiteData {
  readonly url: string | null;
  readonly summary: string | null;
  readonly source: SourceRef;
}

/** A business, or a person's home listing (never delivered, FR-25). */
export type Listing = 'business' | 'home';

/** How far a Prospect got: found, pre-scored (Step 4), scored with a Fit score (Step 9). */
export type ProspectStage = 'new' | 'pre_scored' | 'scored';

export interface ProspectSnapshot {
  readonly id: string;
  readonly runId: string;
  readonly businessId: string;
  readonly name: string;
  readonly address: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly category: string | null;
  readonly phoneNormalised: string | null;
  readonly domain: string | null;
  /** Provider place keys (`google:…`, `osm:node/…`) plus derived `phone:` and `domain:` keys. */
  readonly placeKeys: readonly string[];
  readonly preScore: number | null;
  readonly fitScore: number | null;
  readonly listing: Listing;
  readonly contacts: readonly ProspectContact[];
  readonly evidence: readonly EvidenceItem[];
  readonly pitch: Pitch | null;
  readonly website: WebsiteData | null;
  /** Where the place itself was found. */
  readonly sources: readonly SourceRef[];
  /** Other collected facts (rating, reviews count, hours…), for scoring. */
  readonly facts: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/** A place as a Tool found it (FR-19 Step 2). */
export interface ProspectInput {
  readonly name: string;
  readonly address?: string | null | undefined;
  readonly lat?: number | null | undefined;
  readonly lng?: number | null | undefined;
  readonly category?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly website?: string | null | undefined;
  readonly placeKeys?: readonly string[] | undefined;
  readonly source: SourceRef;
  readonly listing?: Listing | undefined;
  readonly facts?: Readonly<Record<string, unknown>> | undefined;
}

export interface ContactInput {
  readonly type: ContactType;
  readonly value: string;
  readonly label?: string | null | undefined;
  readonly verification: Verification;
  readonly source: SourceRef;
  /** True when this carries a verification check's result (FR-19 Step 8, `lead_contact_verified`). */
  readonly checked?: boolean | undefined;
}

/** What later Steps add to a Prospect (FR-19 Steps 4–9). Omitted fields are kept. */
export interface ProspectPatch {
  readonly website?: WebsiteData | null | undefined;
  /** Merged with the existing Contacts by type and value; a check result replaces the old one. */
  readonly contacts?: readonly ContactInput[] | undefined;
  /** Replaces the Evidence list (Step 9 scores the Prospect as a whole). */
  readonly evidence?: readonly EvidenceItem[] | undefined;
  readonly preScore?: number | undefined;
  readonly fitScore?: number | undefined;
  readonly pitch?: Pitch | undefined;
  readonly listing?: Listing | undefined;
  readonly category?: string | null | undefined;
  readonly facts?: Readonly<Record<string, unknown>> | undefined;
}

/** A contact check result, for `lead_contact_verified`. */
export interface ContactCheck {
  readonly type: 'email' | 'phone';
  readonly result: 'verified' | 'invalid' | 'unknown';
}

export type NotDeliveredReason =
  | 'not_scored'
  | 'below_min_score'
  | 'no_verified_contact'
  | 'already_delivered'
  | 'not_a_business'
  | 'no_pitch';

/** Same place when within this distance and with the same name (FR-19 Step 3). */
export const SAME_PLACE_METERS = 50;

const LIMITS = { name: 255, address: 500, category: 120, label: 120, value: 2048, fact: 300 };
const PITCH_LIMITS = { productName: 120, reason: 500 };

function score(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new ValidationError(`${field} must be a whole number from 0 to 100`, {
      [field]: 'Must be a whole number from 0 to 100',
    });
  }
  return value;
}

export function sourceRef(raw: SourceRef): SourceRef {
  const name = raw.name.trim();
  const at = new Date(raw.retrievedAt);
  if (!name) throw new ValidationError('A Source needs a name', { source: 'Name required' });
  if (Number.isNaN(at.getTime())) {
    throw new ValidationError('A Source needs a valid retrieval time', {
      source: 'Invalid retrievedAt',
    });
  }
  return {
    name: clip(name, 120),
    url: raw.url ? clip(raw.url, LIMITS.value) : null,
    retrievedAt: at.toISOString(),
  };
}

function contactFrom(input: ContactInput): ProspectContact {
  const value = input.value.trim();
  if (!value) throw new ValidationError('A Contact needs a value', { contact: 'Value required' });
  return {
    type: input.type,
    value: input.type === 'email' ? value.toLowerCase() : clip(value, LIMITS.value),
    label: input.label ? clip(input.label, LIMITS.label) : null,
    verification: input.verification,
    source: sourceRef(input.source),
  };
}

export function evidenceFrom(input: EvidenceItem): EvidenceItem {
  if (!Number.isInteger(input.points) || input.points < -30 || input.points > 40) {
    throw new ValidationError('Evidence points must be whole numbers from -30 to 40', {
      points: 'Must be from -30 to 40',
    });
  }
  const fact = input.fact.trim();
  if (!fact) throw new ValidationError('Evidence needs a fact', { fact: 'Required' });
  return { fact: clip(fact, LIMITS.fact), points: input.points, source: sourceRef(input.source) };
}

function pitchFrom(input: Pitch): Pitch {
  const productName = input.productName.trim();
  const reason = input.reason.trim();
  if (!productName || !reason) {
    throw new ValidationError('A Pitch needs a Product and a reason', { pitch: 'Required' });
  }
  return {
    productId: input.productId,
    productName: clip(productName, PITCH_LIMITS.productName),
    reason: clip(reason, PITCH_LIMITS.reason),
  };
}

function coordinate(value: number | null | undefined, max: number, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || Math.abs(value) > max) {
    throw new ValidationError(`Invalid ${field}`, { [field]: 'Out of range' });
  }
  return value;
}

/** A check result overrides what was known; an unchecked sighting never downgrades it. */
function mergeContacts(
  current: readonly ProspectContact[],
  incoming: readonly ProspectContact[],
): ProspectContact[] {
  const merged = [...current];
  for (const c of incoming) {
    const key = contactKey(c.type, c.value);
    const at = merged.findIndex((m) => contactKey(m.type, m.value) === key);
    const existing = at >= 0 ? merged[at] : undefined;
    if (!existing) {
      merged.push(c);
      continue;
    }
    const checked = c.verification !== 'unverified' || existing.verification === 'unverified';
    merged[at] = {
      ...existing,
      label: existing.label ?? c.label,
      ...(checked ? { verification: c.verification, source: c.source } : {}),
    };
  }
  return merged;
}

function sameSource(a: SourceRef, b: SourceRef): boolean {
  return a.name === b.name && a.url === b.url && a.retrievedAt === b.retrievedAt;
}

function derivedKeys(phone: string | null, domain: string | null): string[] {
  return [...(phone ? [`phone:${phone}`] : []), ...(domain ? [`domain:${domain}`] : [])];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * A business found during a run, before it is qualified (glossary). Prospects of one run are
 * merged when they are the same place (FR-19 Step 3); later Steps add website data, Contacts with
 * their verification, Evidence, scores and a Pitch; Step 10 delivers the qualified ones (FR-25).
 */
export class Prospect {
  private constructor(private s: ProspectSnapshot) {}

  static found(props: {
    id: string;
    runId: string;
    businessId: string;
    input: ProspectInput;
    now: Date;
  }): Prospect {
    const { input } = props;
    const name = input.name.trim();
    if (!name) throw new ValidationError('A Prospect needs a name', { name: 'Required' });
    const source = sourceRef(input.source);
    const phone = normalisePhone(input.phone);
    const domain = domainOf(input.website);
    const placeKeys = unique([
      ...(input.placeKeys ?? []).map((k) => k.trim()).filter(Boolean),
      ...derivedKeys(phone, domain),
    ]);
    if (placeKeys.length === 0) {
      throw new ValidationError('A Prospect needs a place key, phone or website', {
        placeKeys: 'Required',
      });
    }
    const contacts: ProspectContact[] = [];
    if (phone && input.phone) {
      contacts.push(
        contactFrom({ type: 'phone', value: input.phone, verification: 'unverified', source }),
      );
    }
    if (input.website?.trim()) {
      contacts.push(
        contactFrom({ type: 'website', value: input.website, verification: 'unverified', source }),
      );
    }
    return new Prospect({
      id: props.id,
      runId: props.runId,
      businessId: props.businessId,
      name: clip(name, LIMITS.name),
      address: input.address?.trim() ? clip(input.address, LIMITS.address) : null,
      lat: coordinate(input.lat, 90, 'lat'),
      lng: coordinate(input.lng, 180, 'lng'),
      category: input.category?.trim() ? clip(input.category, LIMITS.category) : null,
      phoneNormalised: phone,
      domain,
      placeKeys,
      preScore: null,
      fitScore: null,
      listing: input.listing ?? 'business',
      contacts,
      evidence: [],
      pitch: null,
      website: null,
      sources: [source],
      facts: { ...(input.facts ?? {}) },
      createdAt: props.now,
    });
  }

  /** Rehydrate from storage; no checks. */
  static restore(snapshot: ProspectSnapshot): Prospect {
    return new Prospect(snapshot);
  }

  get id(): string {
    return this.s.id;
  }
  get runId(): string {
    return this.s.runId;
  }
  get businessId(): string {
    return this.s.businessId;
  }
  get fitScore(): number | null {
    return this.s.fitScore;
  }
  get preScore(): number | null {
    return this.s.preScore;
  }
  get placeKeys(): readonly string[] {
    return this.s.placeKeys;
  }
  get name(): string {
    return this.s.name;
  }

  get stage(): ProspectStage {
    if (this.s.fitScore !== null) return 'scored';
    if (this.s.preScore !== null) return 'pre_scored';
    return 'new';
  }

  /** The key a Lead is stored under: the first provider place key, else a derived one. */
  get placeKey(): string {
    const provider = this.s.placeKeys.find((k) => !/^(phone|domain):/.test(k));
    return provider ?? this.s.placeKeys[0] ?? `prospect:${this.s.id}`;
  }

  /** Same place: a shared place key, phone or domain, or the same name within 50 m. */
  isSamePlaceAs(other: Prospect): boolean {
    const a = this.s;
    const b = other.s;
    if (a.placeKeys.some((k) => b.placeKeys.includes(k))) return true;
    if (a.phoneNormalised && a.phoneNormalised === b.phoneNormalised) return true;
    if (a.domain && a.domain === b.domain) return true;
    if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return false;
    if (normaliseName(a.name) !== normaliseName(b.name)) return false;
    return (
      distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) <= SAME_PLACE_METERS
    );
  }

  /** Takes in a duplicate: keys, contacts and Sources are combined; known facts are kept. */
  absorb(other: Prospect): void {
    const a = this.s;
    const b = other.s;
    this.s = {
      ...a,
      address: a.address ?? b.address,
      lat: a.lat ?? b.lat,
      lng: a.lng ?? b.lng,
      category: a.category ?? b.category,
      phoneNormalised: a.phoneNormalised ?? b.phoneNormalised,
      domain: a.domain ?? b.domain,
      placeKeys: unique([...a.placeKeys, ...b.placeKeys]),
      listing: a.listing === 'home' || b.listing === 'home' ? 'home' : 'business',
      contacts: mergeContacts(a.contacts, b.contacts),
      sources: [...a.sources, ...b.sources.filter((x) => !a.sources.some((y) => sameSource(x, y)))],
      facts: { ...b.facts, ...a.facts },
    };
  }

  /** Applies what a later Step found. Returns the email and phone check results it carried. */
  apply(patch: ProspectPatch): ContactCheck[] {
    const contacts = (patch.contacts ?? []).map(contactFrom);
    const next: ProspectSnapshot = {
      ...this.s,
      ...(patch.preScore !== undefined ? { preScore: score(patch.preScore, 'preScore') } : {}),
      ...(patch.fitScore !== undefined ? { fitScore: score(patch.fitScore, 'fitScore') } : {}),
      ...(patch.pitch !== undefined ? { pitch: pitchFrom(patch.pitch) } : {}),
      ...(patch.evidence !== undefined ? { evidence: patch.evidence.map(evidenceFrom) } : {}),
      ...(patch.listing !== undefined ? { listing: patch.listing } : {}),
      ...(patch.category !== undefined
        ? { category: patch.category?.trim() ? clip(patch.category, LIMITS.category) : null }
        : {}),
      ...(patch.website !== undefined
        ? {
            website: patch.website
              ? {
                  url: patch.website.url ? clip(patch.website.url, LIMITS.value) : null,
                  summary: patch.website.summary ? clip(patch.website.summary, 2000) : null,
                  source: sourceRef(patch.website.source),
                }
              : null,
          }
        : {}),
      ...(patch.facts !== undefined ? { facts: { ...this.s.facts, ...patch.facts } } : {}),
      contacts: mergeContacts(this.s.contacts, contacts),
    };
    const phone =
      next.phoneNormalised ??
      normalisePhone(
        contacts.find((c) => c.type === 'phone' && c.verification !== 'invalid')?.value,
      );
    const domain =
      next.domain ??
      domainOf(patch.website?.url ?? contacts.find((c) => c.type === 'website')?.value);
    this.s = {
      ...next,
      phoneNormalised: phone,
      domain,
      placeKeys: unique([...next.placeKeys, ...derivedKeys(phone, domain)]),
    };
    return (patch.contacts ?? []).flatMap((c): ContactCheck[] =>
      c.checked && (c.type === 'email' || c.type === 'phone')
        ? [{ type: c.type, result: c.verification === 'unverified' ? 'unknown' : c.verification }]
        : [],
    );
  }

  /** FR-25: why this Prospect can't become a Lead, or null when it qualifies. */
  notDeliveredReason(rules: {
    minFitScore: number;
    deliveredKeys: ReadonlySet<string>;
  }): NotDeliveredReason | null {
    const s = this.s;
    if (s.listing !== 'business') return 'not_a_business';
    if (s.placeKeys.some((k) => rules.deliveredKeys.has(k))) return 'already_delivered';
    if (s.fitScore === null) return 'not_scored';
    if (s.fitScore < rules.minFitScore) return 'below_min_score';
    if (!s.pitch) return 'no_pitch';
    const verified = s.contacts.some(
      (c) => (c.type === 'phone' || c.type === 'email') && c.verification === 'verified',
    );
    if (!verified) return 'no_verified_contact';
    return null;
  }

  /** The Contacts a Lead keeps: invalid ones are dropped (FR-25). */
  deliverableContacts(): ProspectContact[] {
    return this.s.contacts.filter((c) => c.verification !== 'invalid');
  }

  toSnapshot(): ProspectSnapshot {
    return this.s;
  }
}

/** FR-25 ranking: Fit score, then pre-score, then name. */
export function byRank(a: Prospect, b: Prospect): number {
  return (
    (b.fitScore ?? -1) - (a.fitScore ?? -1) ||
    (b.preScore ?? -1) - (a.preScore ?? -1) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * FR-25: the Prospects that become Leads, ranked by Fit score and capped at `capacity` (max leads
 * minus the Leads this run already delivered).
 */
export function selectForDelivery(
  prospects: readonly Prospect[],
  rules: { minFitScore: number; deliveredKeys: ReadonlySet<string>; capacity: number },
): Prospect[] {
  const taken = new Set(rules.deliveredKeys);
  const chosen: Prospect[] = [];
  for (const p of [...prospects].sort(byRank)) {
    if (chosen.length >= rules.capacity) break;
    if (p.notDeliveredReason({ minFitScore: rules.minFitScore, deliveredKeys: taken }) !== null) {
      continue;
    }
    chosen.push(p);
    for (const k of p.placeKeys) taken.add(k);
  }
  return chosen;
}
