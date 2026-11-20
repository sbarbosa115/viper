import type { Lead, LeadSummary } from '@app/contracts/leads';
import type { Actor } from '../../../shared/domain/actor.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import type { LeadCursor, LeadListRow, LeadRecord, LeadSort } from '../domain/lead.js';

/** Leads belong to the Actor's Business (the target while Acting as); Owners use them. */
export function assertCanUseLeads(actor: Actor): void {
  if (!actor.roles.includes('owner')) throw new ForbiddenError('Only the Owner can see Leads');
}

export function leadNotFound(leadId: string): NotFoundError {
  return new NotFoundError('Lead not found', { leadId });
}

export function planNotFound(planId: string): NotFoundError {
  return new NotFoundError('Plan not found', { planId });
}

export function encodeLeadCursor(c: LeadCursor): string {
  return Buffer.from(JSON.stringify([c.sort, c.key, c.id])).toString('base64url');
}

function invalidCursor(cursor: string): ValidationError {
  return new ValidationError('Invalid cursor', { cursor: `Invalid cursor ${cursor.slice(0, 20)}` });
}

/** Decodes a cursor made by `encodeLeadCursor` for the same sort. */
export function decodeLeadCursor(cursor: string, sort: LeadSort): LeadCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw invalidCursor(cursor);
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) throw invalidCursor(cursor);
  const [s, key, id] = parsed as unknown[];
  if (s !== sort || typeof id !== 'string') throw invalidCursor(cursor);
  const keyOk =
    sort === 'score'
      ? typeof key === 'number'
      : sort === 'distance'
        ? key === null || typeof key === 'number'
        : typeof key === 'string' && !Number.isNaN(new Date(key).getTime());
  if (!keyOk) throw invalidCursor(cursor);
  return { sort, key: key as LeadCursor['key'], id };
}

export function leadSummaryOf(row: LeadListRow): LeadSummary {
  const has = (t: string) => row.contactTypes.includes(t as LeadListRow['contactTypes'][number]);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    distanceMiles: row.distanceMiles,
    fitScore: row.fitScore,
    contacts: {
      phone: has('phone'),
      email: has('email'),
      website: has('website'),
      instagram: has('instagram'),
      tiktok: has('tiktok'),
    },
    feedback: row.feedback,
    runId: row.runId,
    deliveredAt: row.deliveredAt.toISOString(),
  };
}

export function leadOf(r: LeadRecord): Lead {
  return {
    ...leadSummaryOf({ ...r, contactTypes: r.contacts.map((c) => c.type) }),
    address: r.address,
    contacts: r.contacts.map((c) => ({
      type: c.type,
      value: c.value,
      label: c.label,
      verification: c.verification,
      source: { ...c.source },
    })),
    // Facts worth 0 points (e.g. a website summary) inform the score but aren't shown as Evidence.
    evidence: r.evidence
      .filter((e) => e.points !== 0)
      .map((e) => ({ fact: e.fact, points: e.points, source: { ...e.source } })),
    pitch: { ...r.pitch },
    feedbackReason: r.feedbackReason,
    planId: r.planId,
  };
}
