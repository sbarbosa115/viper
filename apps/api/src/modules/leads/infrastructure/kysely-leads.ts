import {
  sql,
  type Expression,
  type ExpressionBuilder,
  type Kysely,
  type SqlBool,
  type Transaction,
} from 'kysely';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import { KyselyUnitOfWork } from '../../../shared/infrastructure/db/unit-of-work.js';
import type {
  LeadFilterValues,
  LeadQuality,
  LeadRepository,
  LeadsUnitOfWork,
  LeadTotals,
  NewLead,
  NewSource,
  ProspectRepository,
} from '../application/ports.js';
import type { Feedback, LeadCursor, LeadListRow, LeadRecord } from '../domain/lead.js';
import {
  Prospect,
  type EvidenceItem,
  type Listing,
  type Pitch,
  type ProspectContact,
  type ProspectSnapshot,
  type SourceRef,
  type WebsiteData,
} from '../domain/prospect.js';

type Db = Kysely<DB> | Transaction<DB>;

/** The `prospects.data` JSON: everything a Prospect collects beyond its indexed columns. */
interface ProspectData {
  fitScore: number | null;
  listing: Listing;
  contacts: ProspectContact[];
  evidence: EvidenceItem[];
  pitch: Pitch | null;
  website: WebsiteData | null;
  sources: SourceRef[];
  facts: Record<string, unknown>;
}

export class KyselyProspectRepository implements ProspectRepository {
  constructor(private readonly db: Db) {}

  async listByRun(runId: string): Promise<Prospect[]> {
    const rows = await this.db
      .selectFrom('prospects')
      .selectAll()
      .where('run_id', '=', runId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return rows.map(toProspect);
  }

  async findById(prospectId: string): Promise<Prospect | null> {
    const row = await this.db
      .selectFrom('prospects')
      .selectAll()
      .where('id', '=', prospectId)
      .executeTakeFirst();
    return row ? toProspect(row) : null;
  }

  async save(prospect: Prospect): Promise<void> {
    const s = prospect.toSnapshot();
    const data: ProspectData = {
      fitScore: s.fitScore,
      listing: s.listing,
      contacts: [...s.contacts],
      evidence: [...s.evidence],
      pitch: s.pitch,
      website: s.website,
      sources: [...s.sources],
      facts: { ...s.facts },
    };
    const values = {
      name: s.name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      category: s.category,
      phone_normalised: s.phoneNormalised,
      domain: s.domain,
      place_keys: JSON.stringify(s.placeKeys),
      pre_score: s.preScore,
      data: JSON.stringify(data),
    };
    await this.db
      .insertInto('prospects')
      .values({
        id: s.id,
        run_id: s.runId,
        business_id: s.businessId,
        created_at: s.createdAt,
        ...values,
      })
      .onDuplicateKeyUpdate(values)
      .execute();
  }
}

function toProspect(row: {
  id: string;
  run_id: string;
  business_id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  category: string | null;
  phone_normalised: string | null;
  domain: string | null;
  place_keys: string[];
  pre_score: number | null;
  data: Record<string, unknown>;
  created_at: Date;
}): Prospect {
  const data = row.data as unknown as ProspectData;
  const snapshot: ProspectSnapshot = {
    id: row.id,
    runId: row.run_id,
    businessId: row.business_id,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    category: row.category,
    phoneNormalised: row.phone_normalised,
    domain: row.domain,
    placeKeys: row.place_keys,
    preScore: row.pre_score,
    fitScore: data.fitScore,
    listing: data.listing,
    contacts: data.contacts,
    evidence: data.evidence,
    pitch: data.pitch,
    website: data.website,
    sources: data.sources,
    facts: data.facts,
    createdAt: row.created_at,
  };
  return Prospect.restore(snapshot);
}

const sourceOf = (s: { source_name: string; source_url: string | null; retrieved_at: Date }) => ({
  name: s.source_name,
  url: s.source_url,
  retrievedAt: new Date(s.retrieved_at).toISOString(),
});

/** `LIKE` pattern for a search term, with `%`, `_` and `\` matched literally. */
function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

type LeadsEb = ExpressionBuilder<DB, 'leads'>;

function afterCursor(eb: LeadsEb, c: LeadCursor): Expression<SqlBool> {
  if (c.sort === 'score') {
    const k = Number(c.key);
    return eb.or([
      eb('leads.fit_score', '<', k),
      eb.and([eb('leads.fit_score', '=', k), eb('leads.id', '>', c.id)]),
    ]);
  }
  if (c.sort === 'newest') {
    const k = new Date(String(c.key));
    return eb.or([
      eb('leads.delivered_at', '<', k),
      eb.and([eb('leads.delivered_at', '=', k), eb('leads.id', '>', c.id)]),
    ]);
  }
  if (c.key === null) {
    return eb.and([eb('leads.distance_miles', 'is', null), eb('leads.id', '>', c.id)]);
  }
  const k = Number(c.key);
  return eb.or([
    eb('leads.distance_miles', 'is', null),
    eb('leads.distance_miles', '>', k),
    eb.and([eb('leads.distance_miles', '=', k), eb('leads.id', '>', c.id)]),
  ]);
}

function filtered(eb: LeadsEb, f: LeadFilterValues): Expression<SqlBool> {
  const conditions: Expression<SqlBool>[] = [eb('leads.removed_at', 'is', null)];
  if (f.runId) conditions.push(eb('leads.run_id', '=', f.runId));
  if (f.minScore !== undefined) conditions.push(eb('leads.fit_score', '>=', f.minScore));
  if (f.feedback === 'none') conditions.push(eb('leads.feedback', 'is', null));
  else if (f.feedback) conditions.push(eb('leads.feedback', '=', f.feedback));
  if (f.q) conditions.push(eb('leads.name', 'like', containsPattern(f.q)));
  return eb.and(conditions);
}

export class KyselyLeadRepository implements LeadRepository {
  constructor(private readonly db: Db) {}

  async deliveredPlaceKeys(planId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectFrom('leads')
      .innerJoin('prospects', 'prospects.id', 'leads.prospect_id')
      .select(['leads.place_key', 'prospects.place_keys'])
      .where('leads.plan_id', '=', planId)
      .execute();
    const keys = new Set<string>();
    for (const r of rows) {
      keys.add(r.place_key);
      for (const k of r.place_keys) keys.add(k);
    }
    return keys;
  }

  async countByRun(runId: string): Promise<number> {
    const row = await this.db
      .selectFrom('leads')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('run_id', '=', runId)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async insert(sources: readonly NewSource[], leads: readonly NewLead[]): Promise<void> {
    if (sources.length > 0) {
      await this.db
        .insertInto('sources')
        .values(
          sources.map((s) => ({
            id: s.id,
            name: s.name,
            url: s.url,
            retrieved_at: new Date(s.retrievedAt),
          })),
        )
        .execute();
    }
    if (leads.length === 0) return;
    await this.db
      .insertInto('leads')
      .values(
        leads.map((l) => ({
          id: l.id,
          business_id: l.businessId,
          plan_id: l.planId,
          run_id: l.runId,
          prospect_id: l.prospectId,
          place_key: l.placeKey,
          name: l.name,
          category: l.category,
          address: l.address,
          distance_miles: l.distanceMiles,
          fit_score: l.fitScore,
          pitch_product_id: l.pitch.productId,
          pitch_product_name: l.pitch.productName,
          pitch_reason: l.pitch.reason,
          feedback: null,
          feedback_reason: null,
          feedback_at: null,
          removed_at: null,
          delivered_at: l.deliveredAt,
        })),
      )
      .execute();
    const contacts = leads.flatMap((l) =>
      l.contacts.map((c) => ({
        id: c.id,
        lead_id: l.id,
        type: c.type,
        value: c.value,
        label: c.label,
        verification: c.verification,
        source_id: c.sourceId,
      })),
    );
    if (contacts.length > 0) await this.db.insertInto('lead_contacts').values(contacts).execute();
    const evidence = leads.flatMap((l) =>
      l.evidence.map((e, position) => ({
        id: e.id,
        lead_id: l.id,
        fact: e.fact,
        points: e.points,
        source_id: e.sourceId,
        position,
      })),
    );
    if (evidence.length > 0) await this.db.insertInto('lead_evidence').values(evidence).execute();
  }

  async findMany(businessId: string, leadIds: readonly string[]): Promise<LeadRecord[]> {
    if (leadIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('leads')
      .selectAll()
      .where('business_id', '=', businessId)
      .where('id', 'in', [...leadIds])
      .where('removed_at', 'is', null)
      .execute();
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [contacts, evidence] = await Promise.all([
      this.db
        .selectFrom('lead_contacts as c')
        .innerJoin('sources as s', 's.id', 'c.source_id')
        .select([
          'c.id',
          'c.lead_id',
          'c.type',
          'c.value',
          'c.label',
          'c.verification',
          's.name as source_name',
          's.url as source_url',
          's.retrieved_at',
        ])
        .where('c.lead_id', 'in', ids)
        .orderBy('c.lead_id')
        .orderBy('c.type')
        .orderBy('c.id')
        .execute(),
      this.db
        .selectFrom('lead_evidence as e')
        .innerJoin('sources as s', 's.id', 'e.source_id')
        .select([
          'e.lead_id',
          'e.fact',
          'e.points',
          's.name as source_name',
          's.url as source_url',
          's.retrieved_at',
        ])
        .where('e.lead_id', 'in', ids)
        .orderBy('e.lead_id')
        .orderBy('e.position')
        .execute(),
    ]);
    const byIdOrder = new Map(leadIds.map((id, i) => [id, i]));
    return rows
      .map((r): LeadRecord => ({
        id: r.id,
        businessId: r.business_id,
        planId: r.plan_id,
        runId: r.run_id,
        prospectId: r.prospect_id,
        placeKey: r.place_key,
        name: r.name,
        category: r.category,
        address: r.address,
        distanceMiles: r.distance_miles === null ? null : Number(r.distance_miles),
        fitScore: r.fit_score,
        pitch: {
          productId: r.pitch_product_id,
          productName: r.pitch_product_name,
          reason: r.pitch_reason,
        },
        feedback: r.feedback,
        feedbackReason: r.feedback_reason,
        feedbackAt: r.feedback_at,
        deliveredAt: r.delivered_at,
        contacts: contacts
          .filter((c) => c.lead_id === r.id)
          .map((c) => ({
            type: c.type,
            value: c.value,
            label: c.label,
            verification: c.verification,
            source: sourceOf(c),
          })),
        evidence: evidence
          .filter((e) => e.lead_id === r.id)
          .map((e) => ({ fact: e.fact, points: e.points, source: sourceOf(e) })),
      }))
      .sort((a, b) => (byIdOrder.get(a.id) ?? 0) - (byIdOrder.get(b.id) ?? 0));
  }

  async saveFeedback(leadId: string, feedback: Feedback | null, at: Date): Promise<void> {
    await this.db
      .updateTable('leads')
      .set({
        feedback: feedback?.value ?? null,
        feedback_reason: feedback?.reason ?? null,
        feedback_at: feedback ? at : null,
      })
      .where('id', '=', leadId)
      .execute();
  }

  async list(
    scope: { businessId: string; planId: string },
    filters: LeadFilterValues,
    page: { after?: LeadCursor | undefined; limit: number },
  ): Promise<LeadListRow[]> {
    let query = this.db
      .selectFrom('leads')
      .select([
        'leads.id',
        'leads.run_id',
        'leads.name',
        'leads.category',
        'leads.distance_miles',
        'leads.fit_score',
        'leads.feedback',
        'leads.delivered_at',
      ])
      .where('leads.business_id', '=', scope.businessId)
      .where('leads.plan_id', '=', scope.planId)
      .where((eb) => filtered(eb, filters));
    const { after } = page;
    if (after) query = query.where((eb) => afterCursor(eb, after));
    if (filters.sort === 'score') {
      query = query.orderBy('leads.fit_score', 'desc').orderBy('leads.id', 'asc');
    } else if (filters.sort === 'newest') {
      query = query.orderBy('leads.delivered_at', 'desc').orderBy('leads.id', 'asc');
    } else {
      query = query
        .orderBy(sql`leads.distance_miles is null`)
        .orderBy('leads.distance_miles', 'asc')
        .orderBy('leads.id', 'asc');
    }
    const rows = await query.limit(page.limit).execute();
    if (rows.length === 0) return [];
    const types = await this.db
      .selectFrom('lead_contacts')
      .select(['lead_id', 'type'])
      .distinct()
      .where(
        'lead_id',
        'in',
        rows.map((r) => r.id),
      )
      .execute();
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      name: r.name,
      category: r.category,
      distanceMiles: r.distance_miles === null ? null : Number(r.distance_miles),
      fitScore: r.fit_score,
      feedback: r.feedback,
      deliveredAt: r.delivered_at,
      contactTypes: types.filter((t) => t.lead_id === r.id).map((t) => t.type),
    }));
  }

  async totals(scope: {
    businessId: string;
    planId: string;
    runId?: string | undefined;
  }): Promise<LeadTotals> {
    const inScope = (eb: LeadsEb) =>
      eb.and([
        eb('leads.business_id', '=', scope.businessId),
        eb('leads.plan_id', '=', scope.planId),
        eb('leads.removed_at', 'is', null),
        ...(scope.runId ? [eb('leads.run_id', '=', scope.runId)] : []),
      ]);
    const [leads, contacts] = await Promise.all([
      this.db
        .selectFrom('leads')
        .select((eb) => [
          eb.fn.countAll<number>().as('total'),
          eb.fn.coalesce(eb.fn.sum<number>('leads.fit_score'), sql<number>`0`).as('fit_sum'),
        ])
        .where(inScope)
        .executeTakeFirstOrThrow(),
      this.contactTotals(inScope),
    ]);
    return {
      total: Number(leads.total),
      fitScoreSum: Number(leads.fit_sum),
      ...contacts,
    };
  }

  async countsByPlan(businessId: string, planIds: readonly string[]): Promise<Map<string, number>> {
    if (planIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('leads')
      .select((eb) => ['plan_id', eb.fn.countAll<number>().as('n')])
      .where('business_id', '=', businessId)
      .where('plan_id', 'in', [...planIds])
      .where('removed_at', 'is', null)
      .groupBy('plan_id')
      .execute();
    return new Map(rows.map((r) => [r.plan_id, Number(r.n)]));
  }

  async countsByBusiness(businessIds: readonly string[]): Promise<Map<string, number>> {
    if (businessIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('leads')
      .select((eb) => ['business_id', eb.fn.countAll<number>().as('n')])
      .where('business_id', 'in', [...businessIds])
      .where('removed_at', 'is', null)
      .groupBy('business_id')
      .execute();
    return new Map(rows.map((r) => [r.business_id, Number(r.n)]));
  }

  async quality(window: { from: Date; to: Date }): Promise<LeadQuality> {
    const inWindow = (eb: LeadsEb) =>
      eb.and([
        eb('leads.delivered_at', '>=', window.from),
        eb('leads.delivered_at', '<', window.to),
        eb('leads.removed_at', 'is', null),
      ]);
    const [leads, contacts] = await Promise.all([
      this.db
        .selectFrom('leads')
        .select((eb) => [
          eb.fn.countAll<number>().as('delivered'),
          eb.fn.count<number>('leads.feedback').as('with_feedback'),
          eb.fn
            .coalesce(eb.fn.sum<number>(sql`leads.feedback = 'good'`), sql<number>`0`)
            .as('good'),
        ])
        .where(inWindow)
        .executeTakeFirstOrThrow(),
      this.contactTotals(inWindow),
    ]);
    return {
      delivered: Number(leads.delivered),
      withFeedback: Number(leads.with_feedback),
      good: Number(leads.good),
      ...contacts,
    };
  }

  /** Phone and email Contacts of the Leads `where` selects, and how many are Verified. */
  private async contactTotals(
    where: (eb: LeadsEb) => Expression<SqlBool>,
  ): Promise<{ phoneEmailContacts: number; verifiedPhoneEmail: number }> {
    const row = await this.db
      .selectFrom('lead_contacts')
      .select((eb) => [
        eb.fn.countAll<number>().as('n'),
        eb.fn
          .coalesce(eb.fn.sum<number>(sql`lead_contacts.verification = 'verified'`), sql<number>`0`)
          .as('verified'),
      ])
      .where('lead_contacts.type', 'in', ['phone', 'email'])
      .where(
        'lead_contacts.lead_id',
        'in',
        this.db.selectFrom('leads').select('leads.id').where(where),
      )
      .executeTakeFirstOrThrow();
    return { phoneEmailContacts: Number(row.n), verifiedPhoneEmail: Number(row.verified) };
  }
}

/** leads' Unit of Work on MySQL: Prospect and Lead repositories on one transaction. */
export function kyselyLeadsUnitOfWork(db: Kysely<DB>): LeadsUnitOfWork {
  return new KyselyUnitOfWork(db, (trx) => ({
    prospects: new KyselyProspectRepository(trx),
    leads: new KyselyLeadRepository(trx),
  }));
}
