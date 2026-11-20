import { sql } from 'kysely';
import type { Database } from '../../../shared/infrastructure/db/database.js';
import type { World } from './world.js';

/** Every table the reporting tests write (truncated before each test). */
export const WORLD_TABLES = [
  'lead_evidence',
  'lead_contacts',
  'leads',
  'prospects',
  'sources',
  'tool_calls',
  'tools',
  'run_steps',
  'research_runs',
  'research_flows',
  'credit_ledger',
  'reservations',
  'purchases',
  'credit_packs',
  'sessions',
  'members',
  'businesses',
];

export async function truncateWorld(db: Database): Promise<void> {
  await sql`SET FOREIGN_KEY_CHECKS=0`.execute(db);
  for (const t of WORLD_TABLES) await sql.raw(`TRUNCATE TABLE ${t}`).execute(db);
  await sql`SET FOREIGN_KEY_CHECKS=1`.execute(db);
}

const FLOW_ID = 'f0000000-0000-4000-8000-000000000001';
const PACK_ID = 'c0000000-0000-4000-8000-000000000001';
const SOURCE_ID = 'e0000000-0000-4000-8000-000000000001';
const T0 = new Date('2026-01-01T00:00:00.000Z');

/** Ids derived from a counter (UUID-shaped, unique per prefix). */
function idFactory(prefix: string): () => string {
  let i = 0;
  return () => `${prefix}${String(++i).padStart(7, '0')}-0000-4000-8000-000000000000`.slice(-36);
}

async function inChunks<T>(
  rows: readonly T[],
  size: number,
  write: (chunk: T[]) => Promise<unknown>,
) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

/**
 * Writes a World to the real tables, the way the owning modules store it (fixture builder for
 * the reporting MySQL and performance tests; never used by production code).
 */
export async function writeWorld(db: Database, world: World): Promise<void> {
  const memberId = idFactory('a');
  const ledgerId = idFactory('b');
  const purchaseId = idFactory('d');
  const prospectId = idFactory('9');
  const contactId = idFactory('8');
  const callId = idFactory('7');

  await inChunks(world.businesses, 500, (chunk) =>
    db
      .insertInto('businesses')
      .values(
        chunk.map((b) => ({
          id: b.id,
          name: b.name,
          internal: b.internal,
          created_at: b.signedUpAt,
          last_active_at: b.lastActiveAt,
        })),
      )
      .execute(),
  );
  await inChunks(world.businesses, 500, (chunk) =>
    db
      .insertInto('members')
      .values(
        chunk.map((b) => ({
          id: memberId(),
          business_id: b.id,
          email: b.ownerEmail,
          name: 'Owner',
          password_hash: 'x',
          is_staff: b.ownerIsStaff,
          email_verified_at: b.verifiedAt,
          created_at: b.signedUpAt,
        })),
      )
      .execute(),
  );

  await db
    .insertInto('research_flows')
    .values({
      id: FLOW_ID,
      key: 'local-buyers',
      name: 'Local buyers',
      version: 1,
      settings: JSON.stringify({}),
      steps: JSON.stringify([]),
      created_at: T0,
    })
    .execute();
  await inChunks(world.runs, 500, (chunk) =>
    db
      .insertInto('research_runs')
      .values(
        chunk.map((r) => ({
          id: r.runId,
          business_id: r.businessId,
          plan_id: r.runId,
          flow_id: FLOW_ID,
          flow_version: 1,
          flow_settings: JSON.stringify({}),
          plan_snapshot: JSON.stringify({
            guardrails: { maxCredits: r.maxCredits, maxLeads: 50, minFitScore: 60 },
            icpEdited: r.icpEdited,
          }),
          status: r.status,
          started_by_member_id: r.businessId,
          failure_code: r.failureCode,
          queued_at: r.queuedAt,
          started_at: r.startedAt,
          finished_at: r.finishedAt,
          credits_reserved: r.maxCredits,
          credits_spent: r.creditsSpent,
          provider_cost_micros: r.providerCostMicros,
          leads_delivered: r.leadsDelivered,
        })),
      )
      .execute(),
  );

  await db
    .insertInto('sources')
    .values({ id: SOURCE_ID, name: 'Google Maps', url: null, retrieved_at: T0 })
    .execute();
  await inChunks(world.leads, 2_000, async (chunk) => {
    const prospects = chunk.map((l) => ({ lead: l, id: prospectId() }));
    await db
      .insertInto('prospects')
      .values(
        prospects.map(({ lead, id }) => ({
          id,
          run_id: lead.runId,
          business_id: lead.businessId,
          name: 'Bakery',
          place_keys: JSON.stringify([lead.id]),
          data: JSON.stringify({}),
          created_at: lead.deliveredAt,
        })),
      )
      .execute();
    await db
      .insertInto('leads')
      .values(
        prospects.map(({ lead, id }) => ({
          id: lead.id,
          business_id: lead.businessId,
          plan_id: lead.runId,
          run_id: lead.runId,
          prospect_id: id,
          place_key: lead.id,
          name: 'Bakery',
          fit_score: 80,
          pitch_product_name: 'Cane sugar',
          pitch_reason: 'Bakes daily',
          feedback: lead.feedback,
          feedback_at: lead.feedback ? lead.deliveredAt : null,
          delivered_at: lead.deliveredAt,
        })),
      )
      .execute();
    const contacts = chunk.flatMap((l) =>
      l.contacts.map((c) => ({
        id: contactId(),
        lead_id: l.id,
        type: c.type,
        value: c.type === 'phone' ? '+15125550100' : 'hello@example.test',
        verification: c.verified ? ('verified' as const) : ('unverified' as const),
        source_id: SOURCE_ID,
      })),
    );
    if (contacts.length > 0) await db.insertInto('lead_contacts').values(contacts).execute();
  });

  await db
    .insertInto('credit_packs')
    .values({
      id: PACK_ID,
      name: 'Starter',
      credits: 2_500,
      price_cents: 2_500,
      active: true,
      created_at: T0,
      updated_at: T0,
    })
    .execute();
  const purchases = world.purchases.map((p) => ({ ...p, id: purchaseId() }));
  await inChunks(purchases, 500, (chunk) =>
    db
      .insertInto('purchases')
      .values(
        chunk.map((p) => ({
          id: p.id,
          business_id: p.businessId,
          pack_id: PACK_ID,
          credits: p.credits,
          stripe_session_id: `cs_${p.id}`,
          amount_cents: p.amountCents,
          status: 'paid' as const,
          created_at: p.paidAt,
          paid_at: p.paidAt,
        })),
      )
      .execute(),
  );
  await inChunks(world.ledger, 2_000, (chunk) =>
    db
      .insertInto('credit_ledger')
      .values(
        chunk.map((e) => ({
          id: ledgerId(),
          business_id: e.businessId,
          type: e.type,
          credits: e.credits,
          description: e.type,
          created_at: e.at,
        })),
      )
      .execute(),
  );
  await inChunks(world.reservations, 2_000, (chunk) =>
    db
      .insertInto('reservations')
      .values(
        chunk.map((r) => ({
          run_id: r.runId,
          business_id: r.businessId,
          credits: r.credits,
          status: r.status,
          created_at: T0,
          closed_at: r.status === 'open' ? null : T0,
        })),
      )
      .execute(),
  );

  const toolKeys = [...new Set(world.toolCalls.map((c) => c.toolKey))];
  if (toolKeys.length > 0) {
    await db
      .insertInto('tools')
      .values(
        toolKeys.map((key) => ({
          key,
          name: key,
          provider: key.split('.')[0] ?? key,
          unit: 'request',
          provider_cost_micros_per_unit: 1_000,
          credits_per_unit: 1,
          enabled: true,
          max_units_per_call: 1,
          updated_at: T0,
        })),
      )
      .execute();
  }
  await inChunks(world.toolCalls, 2_000, (chunk) =>
    db
      .insertInto('tool_calls')
      .values(
        chunk.map((c) => ({
          id: callId(),
          reused: c.reused,
          business_id: SOURCE_ID,
          tool_key: c.toolKey,
          input_hash: '0'.repeat(64),
          input: JSON.stringify({}),
          provider_cost_micros: c.providerCostMicros,
          status: c.status,
          created_at: c.at,
        })),
      )
      .execute(),
  );
}
