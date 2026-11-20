import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import {
  CreditPack,
  type CreditPackDetails,
  type CreditPackSnapshot,
} from '../domain/credit-pack.js';
import { ledgerEntry } from '../domain/ledger-entry.js';
import { requireStaff } from './policies.js';
import type {
  AuditRecorder,
  BillingUnitOfWork,
  BusinessDirectory,
  CreditPackRepository,
} from './ports.js';
import { toLedgerEntryView, type LedgerEntryView } from './wallet-queries.js';

export type CreditPackView = Omit<CreditPackSnapshot, 'position'>;

const packView = (p: CreditPack): CreditPackView => {
  const { position: _position, ...rest } = p.toSnapshot();
  return rest;
};

interface Deps {
  uow: BillingUnitOfWork;
  clock: Clock;
  ids: IdGenerator;
  audit: AuditRecorder;
  businesses: BusinessDirectory;
}

/** FR-13: Staff add or remove credits with a reason (Ledger `adjustment`). */
export class AdjustCredits {
  constructor(private readonly deps: Deps) {}

  async execute(
    cmd: { businessId: string; credits: number; reason: string },
    actor: Actor,
  ): Promise<LedgerEntryView> {
    requireStaff(actor);
    if (!(await this.deps.businesses.exists(cmd.businessId))) {
      throw new NotFoundError('Business not found', { businessId: cmd.businessId });
    }
    const entry = await this.apply({ ...cmd, memberId: actor.memberId });
    await this.deps.audit.record({
      staffMemberId: actor.memberId,
      businessId: cmd.businessId,
      action: 'credits.adjusted',
      targetType: 'credit_ledger',
      targetId: entry.id,
      details: { credits: cmd.credits, reason: entry.description },
    });
    return entry;
  }

  /**
   * Writes the adjustment; a removal can't take available below 0 (INSUFFICIENT_CREDITS). With an
   * idempotency key (the demo seed), a repeat returns the entry already written.
   */
  apply(cmd: {
    businessId: string;
    credits: number;
    reason: string;
    memberId: string | null;
    idempotencyKey?: string;
  }): Promise<LedgerEntryView> {
    return this.deps.uow.run(async ({ wallets, ledger }) => {
      const wallet = await wallets.lock(cmd.businessId);
      if (cmd.idempotencyKey) {
        const existing = await ledger.findByIdempotencyKey(cmd.idempotencyKey);
        if (existing) return toLedgerEntryView(existing);
      }
      if (cmd.credits < 0) wallet.assertCovers(-cmd.credits);
      const entry = ledgerEntry({
        id: this.deps.ids.next(),
        businessId: cmd.businessId,
        type: 'adjustment',
        credits: cmd.credits,
        description: cmd.reason,
        idempotencyKey: cmd.idempotencyKey ?? null,
        createdByMemberId: cmd.memberId,
        createdAt: this.deps.clock.now(),
      });
      await ledger.append(entry);
      return toLedgerEntryView(entry);
    });
  }
}

/** FR-13: Staff manage Credit packs; every change goes to the Audit log. */
export class ManageCreditPacks {
  constructor(private readonly deps: Omit<Deps, 'businesses'>) {}

  list(actor: Actor): Promise<CreditPackView[]> {
    return this.deps.uow.run(async ({ packs }) => {
      requireStaff(actor);
      return (await packs.list({ activeOnly: false })).map(packView);
    });
  }

  async create(details: CreditPackDetails, actor: Actor): Promise<CreditPackView> {
    requireStaff(actor);
    const pack = await this.createPack(details);
    await this.audit(actor, 'credit_pack.created', pack);
    return pack;
  }

  async update(id: string, details: CreditPackDetails, actor: Actor): Promise<CreditPackView> {
    requireStaff(actor);
    const pack = await this.deps.uow.run(async ({ packs }) => {
      const found = await packs.findById(id);
      if (!found) throw new NotFoundError('Credit pack not found', { id });
      found.change(details);
      await packs.save(found);
      return packView(found);
    });
    await this.audit(actor, 'credit_pack.updated', pack);
    return pack;
  }

  /** Creates a pack unless one with the same name exists (the seed relies on this). */
  ensure(details: CreditPackDetails): Promise<CreditPackView> {
    return this.deps.uow.run(async ({ packs }) => {
      const found = await packs.findByName(details.name);
      return found ? packView(found) : this.createIn(packs, details);
    });
  }

  private createPack(details: CreditPackDetails): Promise<CreditPackView> {
    return this.deps.uow.run(({ packs }) => this.createIn(packs, details));
  }

  private async createIn(
    packs: CreditPackRepository,
    details: CreditPackDetails,
  ): Promise<CreditPackView> {
    const pack = CreditPack.create({
      ...details,
      id: this.deps.ids.next(),
      position: await packs.nextPosition(),
    });
    await packs.save(pack);
    return packView(pack);
  }

  private audit(actor: Actor, action: string, pack: CreditPackView): Promise<void> {
    return this.deps.audit.record({
      staffMemberId: actor.memberId,
      businessId: null,
      action,
      targetType: 'credit_pack',
      targetId: pack.id,
      details: {
        name: pack.name,
        credits: pack.credits,
        priceCents: pack.priceCents,
        active: pack.active,
      },
    });
  }
}
