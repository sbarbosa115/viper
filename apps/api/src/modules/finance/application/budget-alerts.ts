import type { EmailSender } from '../../../shared/application/email-sender.js';
import { thresholdsReached, type BudgetThreshold } from '../domain/budget.js';
import { dayOfInstant, type MonthKey } from '../domain/calendar.js';
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
 * is recorded (unique month + threshold, so two runs cannot both record it), and in the same
 * transaction one `BudgetAlertRecorded` outbox event asks for the email: only the 100% one when
 * both were reached at once. A recorded alert is never recorded or emailed again, even if the
 * Budget is raised later; SendBudgetAlert retries the email until SMTP accepts it (G-3).
 */
export class RunBudgetCheck {
  constructor(
    private readonly ctx: FinanceContext,
    private readonly budget: BudgetService,
  ) {}

  /** Returns the threshold an email was asked for (empty or one). */
  async execute(): Promise<BudgetThreshold[]> {
    const spend = await this.budget.currentMonthSpend();
    const pending = thresholdsReached(spend.spentCents, spend.budgetCents).filter(
      (t) => !spend.alertsSent.includes(t),
    );
    if (pending.length === 0) return [];

    const now = this.ctx.clock.now();
    const threshold = await this.ctx.store.run(async (repos) => {
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
      const toEmail = inserted.at(-1);
      if (toEmail !== undefined) {
        await repos.events.publish('BudgetAlertRecorded', {
          month: spend.month,
          threshold: toEmail,
        });
      }
      return toEmail;
    });
    return threshold === undefined ? [] : [threshold];
  }

  /** Test hook only (e2e): forgets the month's recorded alerts so the check can fire again. */
  async resetMonth(): Promise<void> {
    const month = (await this.budget.currentMonthSpend()).month;
    await this.ctx.store.run((repos) => repos.budgets.clearAlerts(month));
  }
}

/** Who already got this alert's email, kept across retries of the same event. */
export interface DeliveryProgress {
  readonly delivered: readonly string[];
  save(delivered: readonly string[]): Promise<void>;
}

/**
 * FR-12: on `BudgetAlertRecorded`, emails every Staff Member the month's spend as of now. A
 * failed send throws so the queue retries the event; recipients already emailed are skipped on
 * the retry (`progress`). Fires `budget_alert_sent` once everyone got it.
 */
export class SendBudgetAlert {
  constructor(
    private readonly ctx: Pick<FinanceContext, 'staff' | 'analytics' | 'clock'>,
    private readonly budget: BudgetService,
    private readonly deps: BudgetAlertDeps,
  ) {}

  async execute(
    event: { month: MonthKey; threshold: BudgetThreshold },
    progress?: DeliveryProgress,
  ): Promise<void> {
    const { month, threshold } = event;
    const recipients = await this.ctx.staff.staffRecipients();
    if (recipients.length === 0) {
      this.deps.logger.warn({ month, threshold }, 'budget alert: no Staff Members');
      return;
    }
    const spend = await this.budget.monthSpend(month);
    const facts = {
      threshold,
      month,
      today: dayOfInstant(this.ctx.clock.now()),
      spentCents: spend.spentCents,
      budgetCents: spend.budgetCents,
      pct: spend.pct,
      topItems: spend.topItems,
    };
    const delivered = [...(progress?.delivered ?? [])];
    let failure: unknown = null;
    for (const r of recipients) {
      if (delivered.includes(r.memberId)) continue;
      try {
        await this.deps.email.send(
          budgetAlertEmail({ to: r.email, name: r.name, appUrl: this.deps.appUrl, facts }),
        );
        delivered.push(r.memberId);
      } catch (err) {
        this.deps.logger.warn({ err, month, threshold }, 'budget alert email failed');
        failure = err;
      }
    }
    if (failure !== null) {
      await progress?.save(delivered);
      throw failure instanceof Error ? failure : new Error('budget alert email failed');
    }
    await this.ctx.analytics.track({
      name: 'budget_alert_sent',
      properties: {
        month,
        threshold,
        spent_cents: spend.spentCents,
        budget_cents: spend.budgetCents,
        recipients_count: delivered.length,
      },
    });
  }
}
