import type { Database } from '../../shared/infrastructure/db/database.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Outbox } from '../../shared/infrastructure/outbox/index.js';
import { createBillingSupportQueries } from '../billing/index.js';
import { createResearchSupportQueries } from '../research/index.js';
import {
  addNote,
  openTicket,
  staffReply,
  take,
  type OpenTicketInput,
  type SupportTx,
  type Ticket,
  type TicketChange,
  type TicketContext,
} from './domain/index.js';
import type { BillingForSupport, ResearchForSupport } from './ports.js';
import { KyselySupportStore } from './infrastructure/kysely-support.js';

/** Fixed ids the seed shares across modules (scripts/seed.ts `demo`). */
export interface SupportSeedDemo {
  businesses: { sweetSupply: string; cleanDesk: string };
  /** `member` (Jo Kim) is optional: identity makes up her id when the demo doesn't fix one. */
  members: { owner: string; newOwner: string; staff: string; member?: string };
}

export interface SupportSeedDeps {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  demo: SupportSeedDemo;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** The seed sends no emails: Tickets are written without outbox events. */
const NO_OUTBOX: Outbox = { add: () => Promise.resolve() };

async function memberIdByEmail(db: Database, email: string): Promise<string> {
  const row = await db
    .selectFrom('members')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirst();
  if (!row) throw new Error(`support seed: ${email} is missing, seed identity first`);
  return row.id;
}

/**
 * Demo data (prd-support section 8a), called by scripts/seed.ts after leads. Never in production.
 * Idempotent: nothing happens once Ticket #1001 exists. Tickets go through the domain commands
 * and the real store, with `now` set back in time (no raw SQL).
 */
export async function seed(deps: SupportSeedDeps): Promise<void> {
  await seedSupportDemo(deps, {
    research: createResearchSupportQueries(deps),
    billing: createBillingSupportQueries(deps),
  });
}

/** `seed` on the ports it reads from other modules (the seed's int test gives it fakes). */
export async function seedSupportDemo(
  deps: SupportSeedDeps,
  ports: { research: ResearchForSupport; billing: BillingForSupport },
): Promise<void> {
  const { db, clock, ids, demo } = deps;
  const store = new KyselySupportStore(db, NO_OUTBOX);
  if (await store.read.findByNumber(1001)) return;

  const now = clock.now();
  const ago = (ms: number): TicketContext => ({ now: new Date(now.getTime() - ms), ids });
  const staffId = demo.members.staff;
  const samId = demo.members.owner;
  const joId = demo.members.member ?? (await memberIdByEmail(db, 'member@demo.test'));

  const failedRun = (
    await ports.research.recentRunsForBusiness(demo.businesses.sweetSupply, new Date(0), 50)
  ).find((r) => r.status === 'failed' && r.planName === 'Bakeries near Austin');
  if (!failedRun) throw new Error('support seed: the failed "Bakeries near Austin" run is missing');
  const sweetBalance = await ports.billing.balanceFor(demo.businesses.sweetSupply);
  const stopped = failedRun.stoppedStep
    ? `step ${String(failedRun.stoppedStep.number)} "${failedRun.stoppedStep.name}"`
    : 'a step';

  const open = (
    ctx: TicketContext,
    input: Partial<OpenTicketInput> &
      Pick<OpenTicketInput, 'businessId' | 'openedByMemberId' | 'category' | 'subject' | 'message'>,
  ) =>
    openTicket(
      {
        id: ids.next(),
        runId: null,
        source: 'help',
        pagePath: null,
        balanceAtOpen: sweetBalance,
        ...input,
      },
      ctx,
    );

  /** Creates the Ticket and applies each follow-up change (built from the previous state). */
  async function write(
    tx: SupportTx,
    opened: ReturnType<typeof openTicket>,
    next: ((t: Ticket) => TicketChange)[],
  ): Promise<void> {
    let ticket = await tx.tickets.create(opened);
    for (const step of next) {
      const change = step(ticket);
      await tx.tickets.saveChange(change);
      ticket = change.ticket;
    }
  }

  await store.run(async (tx) => {
    // #1001: Sam's failed run, taken by Staff, with an Internal note and a reply.
    await write(
      tx,
      open(ago(2 * DAY), {
        businessId: demo.businesses.sweetSupply,
        openedByMemberId: samId,
        category: 'run',
        subject: 'Run stopped at Websites',
        message: `My "Bakeries near Austin" run stopped at ${stopped} and I got no leads. Can you take a look?`,
        runId: failedRun.id,
        source: 'run',
        pagePath: `/app/runs/${failedRun.id}`,
      }),
      [
        (t) => take(t, { staffId }, ago(2 * DAY - HOUR)),
        (t) =>
          addNote(
            t,
            {
              staffId,
              text: 'Website reader timed out on 4 of 25 sites. Retry should be safe; checking the provider status.',
            },
            ago(2 * DAY - 2 * HOUR),
          ),
        (t) =>
          staffReply(
            t,
            {
              staffId,
              text: 'Thanks for reporting this. A few websites timed out. We are re-running the step now and will let you know here. No credits were charged for the stopped run.',
            },
            ago(2 * DAY - 3 * HOUR),
          ),
      ],
    );

    // #1002: Jo's invoice question, waiting on Jo.
    await write(
      tx,
      open(ago(DAY), {
        businessId: demo.businesses.sweetSupply,
        openedByMemberId: joId,
        category: 'billing',
        subject: 'Invoice for my Starter pack',
        message: 'Could I get an invoice for the Starter pack we bought this month?',
        pagePath: '/app/billing',
      }),
      [
        (t) =>
          staffReply(
            t,
            {
              staffId,
              text: 'Happy to. Which company name should go on the invoice?',
              then: 'wait_on_customer',
            },
            ago(DAY - 2 * HOUR),
          ),
      ],
    );

    // #1003: closed by Staff 6 days ago (reopenable).
    await write(
      tx,
      open(ago(8 * DAY), {
        businessId: demo.businesses.sweetSupply,
        openedByMemberId: samId,
        category: 'run',
        subject: 'Two phone numbers look wrong',
        message: 'Two of the phone numbers in my bakery leads go to the wrong business.',
        source: 'leads',
        pagePath: '/app/leads',
      }),
      [
        (t) =>
          staffReply(
            t,
            {
              staffId,
              text: 'Thanks. We removed both numbers and fixed the source. Closing this one; reply if you see more.',
              then: 'close',
            },
            ago(6 * DAY),
          ),
      ],
    );

    // #1004: closed 40 days ago (not reopenable).
    await write(
      tx,
      open(ago(42 * DAY), {
        businessId: demo.businesses.sweetSupply,
        openedByMemberId: samId,
        category: 'other',
        subject: "Can't find the CSV export",
        message: 'Where do I download my leads as a CSV file?',
        pagePath: '/app/leads',
      }),
      [
        (t) =>
          staffReply(
            t,
            {
              staffId,
              text: 'Open a Lead list and use Export CSV above the table.',
              then: 'close',
            },
            ago(40 * DAY),
          ),
      ],
    );

    // #1005: Clean Desk Co's Owner, open and unassigned (waiting).
    await write(
      tx,
      open(ago(3 * HOUR), {
        businessId: demo.businesses.cleanDesk,
        openedByMemberId: demo.members.newOwner,
        category: 'account',
        subject: "Can't add my assistant as a Member",
        message: 'I want my assistant to see our leads. Where do I add her as a Member?',
        pagePath: '/app/settings',
        balanceAtOpen: 50,
      }),
      [],
    );
  });
}
