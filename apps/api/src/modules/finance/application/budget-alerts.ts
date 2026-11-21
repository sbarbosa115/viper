import type { EmailSender } from '../../../shared/application/email-sender.js';
import { thresholdsReached, type BudgetThreshold } from '../domain/budget.js';
import { dayOfInstant } from '../domain/calendar.js';
import { budgetAlertEmail } from './budget-alert-email.js';
import type { BudgetService } from './pnl.js';
import type { FinanceContext } from './ports.js';

export interface AlertLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface BudgetAlertDeps {
  email: EmailSender;
  /** APP_URL, for the link into the app. */
  appUrl: string;
  logger: AlertLogger;
}

/**
 * FR-12, the daily budget check. Each threshold (80, 100) reached and not yet alerted this month
 * is recorded first (unique month + threshold, so two runs cannot both send), then one email goes
 * to every Staff Member: only the 100% one when both were reached at once. A recorded alert is
 * never sent again, even if an email fails or the Budget is raised later.
 */
export class RunBudgetCheck {
  constructor(
    private readonly ctx: FinanceContext,
    private readonly budget: BudgetService,
    private readonly deps: BudgetAlertDeps,
  ) {}

  /** Returns the thresholds an email was sent for (empty or one). */
  async execute(): Promise<BudgetThreshold[]> {
    const spend = await this.budget.currentMonthSpend();
    const pending = thresholdsReached(spend.spentCents, spend.budgetCents).filter(
      (t) => !spend.alertsSent.includes(t),
    );
    if (pending.length === 0) return [];

    const now = this.ctx.clock.now();
    const recorded = await this.ctx.store.run(async (repos) => {
      const inserted: BudgetThreshold[] = [];
      for (const t of pending) {
        const won = await repos.budgets.insertAlert(
          spend.month,
          t,
          spend.spentCents,
          spend.budgetCents,
          now,
        );
        if (won) inserted.push(t);
      }
      return inserted;
    });
    const threshold = recorded.at(-1);
    if (threshold === undefined) return [];

    const recipients = await this.ctx.staff.staffRecipients();
    if (recipients.length === 0) {
      this.deps.logger.warn({ month: spend.month, threshold }, 'budget alert: no Staff Members');
      return [];
    }
    const facts = {
      threshold,
      month: spend.month,
      today: dayOfInstant(now),
      spentCents: spend.spentCents,
      budgetCents: spend.budgetCents,
      pct: spend.pct,
      topItems: spend.topItems,
    };
    let delivered = 0;
    for (const r of recipients) {
      try {
        await this.deps.email.send(
          budgetAlertEmail({ to: r.email, name: r.name, appUrl: this.deps.appUrl, facts }),
        );
        delivered += 1;
      } catch (err) {
        this.deps.logger.warn({ err, month: spend.month, threshold }, 'budget alert email failed');
      }
    }
    await this.ctx.analytics.track({
      name: 'budget_alert_sent',
      properties: {
        month: spend.month,
        threshold,
        spent_cents: spend.spentCents,
        budget_cents: spend.budgetCents,
        recipients_count: delivered,
      },
    });
    return [threshold];
  }

  /** Test hook only (e2e): forgets the month's recorded alerts so the check can fire again. */
  async resetMonth(): Promise<void> {
    const month = (await this.budget.currentMonthSpend()).month;
    await this.ctx.store.run((repos) => repos.budgets.clearAlerts(month));
  }
}
