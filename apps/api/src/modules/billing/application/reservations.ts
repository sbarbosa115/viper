import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { ledgerEntry, runDescription } from '../domain/ledger-entry.js';
import { Reservation, type SettlementResult } from '../domain/reservation.js';
import type { BillingUnitOfWork, ExternalTransaction } from './ports.js';

export interface ReservationView {
  runId: string;
  businessId: string;
  credits: number;
  status: 'open' | 'settled' | 'released';
}

interface Deps {
  uow: BillingUnitOfWork;
  clock: Clock;
  ids: IdGenerator;
}

const view = (r: Reservation): ReservationView => ({
  runId: r.runId,
  businessId: r.businessId,
  credits: r.credits,
  status: r.status,
});

/**
 * Research-facing commands (FR-18, FR-20, FR-36). Each is idempotent per run id, and each can run
 * inside the caller's transaction (`within`), so a run and its Reservation commit together.
 */
export class ReservationCommands {
  constructor(private readonly deps: Deps) {}

  /**
   * Holds `credits` for a run. Throws INSUFFICIENT_CREDITS `{ available, required }` when the
   * Business can't cover it. A second call for the same run returns the existing Reservation.
   */
  reserve(
    cmd: { businessId: string; runId: string; credits: number },
    within?: ExternalTransaction,
  ): Promise<ReservationView> {
    return this.deps.uow.run(async ({ wallets, reservations }) => {
      const wallet = await wallets.lock(cmd.businessId);
      const existing = await reservations.findForUpdate(cmd.runId);
      if (existing) return view(existing);
      wallet.assertCovers(cmd.credits);
      const reservation = Reservation.open({ ...cmd, now: this.deps.clock.now() });
      await reservations.save(reservation);
      return view(reservation);
    }, within);
  }

  /**
   * Holds `credits` more for a run being resumed (FR-32/FR-36): extends an open Reservation, or
   * reopens a settled or released one with a new hold for the remaining budget.
   */
  topUpReservation(
    cmd: { runId: string; credits: number },
    within?: ExternalTransaction,
  ): Promise<ReservationView> {
    return this.deps.uow.run(async ({ wallets, reservations }) => {
      const found = await reservations.find(cmd.runId);
      if (!found) throw new NotFoundError('Reservation not found', { runId: cmd.runId });
      const wallet = await wallets.lock(found.businessId);
      const reservation = (await reservations.findForUpdate(cmd.runId)) ?? found;
      wallet.assertCovers(cmd.credits);
      reservation.topUp(cmd.credits);
      await reservations.save(reservation);
      return view(reservation);
    }, within);
  }

  /**
   * Settles a run (FR-20): `creditsSpent` is the run's total chargeable credits across all its
   * attempts (after the failure policy). Charges what was not charged yet, up to the hold, and
   * releases the rest. A second call after the Reservation closed changes nothing.
   */
  settle(
    cmd: { runId: string; creditsSpent: number; planName?: string },
    within?: ExternalTransaction,
  ): Promise<SettlementResult> {
    return this.deps.uow.run(async ({ wallets, reservations, ledger }) => {
      const found = await reservations.find(cmd.runId);
      if (!found) throw new NotFoundError('Reservation not found', { runId: cmd.runId });
      await wallets.lock(found.businessId);
      const reservation = (await reservations.findForUpdate(cmd.runId)) ?? found;
      if (!reservation.isOpen) return { charged: 0, released: 0 };

      const alreadyCharged = await ledger.chargedForRun(cmd.runId);
      const now = this.deps.clock.now();
      const result = reservation.settle(cmd.creditsSpent - alreadyCharged, now);
      await reservations.save(reservation);
      if (result.charged > 0) {
        await ledger.append(
          ledgerEntry({
            id: this.deps.ids.next(),
            businessId: reservation.businessId,
            type: 'settlement',
            credits: -result.charged,
            description: runDescription(cmd.planName),
            runId: cmd.runId,
            createdAt: now,
          }),
        );
      }
      return result;
    }, within);
  }

  /** Gives a run's whole hold back without charging. No-op when already closed or absent. */
  release(cmd: { runId: string }, within?: ExternalTransaction): Promise<SettlementResult> {
    return this.deps.uow.run(async ({ wallets, reservations }) => {
      const found = await reservations.find(cmd.runId);
      if (!found) return { charged: 0, released: 0 };
      await wallets.lock(found.businessId);
      const reservation = (await reservations.findForUpdate(cmd.runId)) ?? found;
      if (!reservation.isOpen) return { charged: 0, released: 0 };
      const result = reservation.release(this.deps.clock.now());
      await reservations.save(reservation);
      return result;
    }, within);
  }
}
