import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { ledgerEntry, TRIAL_DESCRIPTION, trialKey } from '../domain/ledger-entry.js';
import type { BillingUnitOfWork, TrialCreditsSetting } from './ports.js';

/**
 * FR-11: on MemberEmailVerified, grant the configured trial credits once per Business
 * (idempotency key `trial:<businessId>`), so a redelivered event changes nothing.
 */
export class GrantTrialCredits {
  constructor(
    private readonly deps: {
      uow: BillingUnitOfWork;
      clock: Clock;
      ids: IdGenerator;
      trialCredits: TrialCreditsSetting;
    },
  ) {}

  async execute(cmd: { businessId: string }): Promise<{ granted: number }> {
    const credits = await this.deps.trialCredits.trialCredits();
    if (credits <= 0) return { granted: 0 };
    return this.deps.uow.run(async ({ wallets, ledger }) => {
      await wallets.lock(cmd.businessId);
      const key = trialKey(cmd.businessId);
      if (await ledger.findByIdempotencyKey(key)) return { granted: 0 };
      const inserted = await ledger.append(
        ledgerEntry({
          id: this.deps.ids.next(),
          businessId: cmd.businessId,
          type: 'grant',
          credits,
          description: TRIAL_DESCRIPTION,
          idempotencyKey: key,
          createdAt: this.deps.clock.now(),
        }),
      );
      return { granted: inserted ? credits : 0 };
    });
  }
}
