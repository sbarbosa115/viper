import type { EmailMessage, EmailSender } from '../../../shared/application/email-sender.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { RunFailureCode } from '../domain/run.js';
import type { IdentityPort, PlatformSettingsPort, ResearchStore } from './ports.js';

/** An outbox event as the email queue receives it (shared outbox message shape). */
export interface RunEventMessage {
  readonly eventId: string;
  readonly type: string;
  readonly payload: {
    readonly runId: string;
    readonly businessId: string;
    readonly planId: string;
    readonly startedByStaffId: string | null;
    readonly failureCode?: string;
  };
}

export interface RunEmailDeps {
  store: ResearchStore;
  email: EmailSender;
  identity: IdentityPort;
  settings: PlatformSettingsPort;
  clock: Clock;
  /** APP_URL, for links into the app. */
  appUrl: string;
}

/** The reason a run failed, in plain words (FR-21). */
export const FAILURE_IN_PLAIN_WORDS: Readonly<Record<RunFailureCode, string>> = {
  PROVIDER_ERROR: 'One of our data sources was not responding.',
  PROVIDER_NOT_CONFIGURED: 'One of our data sources is not set up right now.',
  TOOL_DISABLED: 'One of our data sources is switched off right now.',
  TIME_LIMIT: 'The research took longer than its time limit.',
  INSUFFICIENT_CREDITS: 'The run used up its credit budget.',
  INVALID_PLAN: 'Something in the Plan could not be used.',
  INTERNAL_ERROR: 'Something went wrong on our side.',
};

type Recipient = 'owner' | 'support';

/**
 * Run emails (FR-22), from the outbox: "Your leads are ready" on RunCompleted ("No new leads this
 * time" when it delivered none), "didn't finish" on
 * RunFailed (plus the support address). No customer email when Staff started the run while
 * Acting as. Each (event, recipient) is sent once, even when the event is delivered twice.
 */
export class RunEmails {
  constructor(private readonly deps: RunEmailDeps) {}

  async handle(event: RunEventMessage): Promise<void> {
    if (event.type !== 'RunCompleted' && event.type !== 'RunFailed') return;
    const run = await this.deps.store.transaction((tx) => tx.runs.find(event.payload.runId));
    if (!run) return;
    const s = run.toSnapshot();
    const app = this.deps.appUrl.replace(/\/$/, '');
    const messages: { to: Recipient; message: () => Promise<EmailMessage | null> }[] = [];

    if (!s.startedByStaffId) {
      messages.push({
        to: 'owner',
        message: async () => {
          const owner = await this.deps.identity.getOwnerContact(s.businessId);
          if (!owner) return null;
          if (event.type === 'RunCompleted' && s.leadsDelivered === 0) {
            return {
              to: owner.email,
              subject: `No new leads this time: ${s.plan.name}`,
              text: [
                `Hi ${owner.name},`,
                '',
                `Your research run finished, but we didn't find any new leads for "${s.plan.name}" this time.`,
                `Credits spent: ${s.creditsSpent}.`,
                '',
                `Open your Plan to widen the search area or adjust it: ${app}/app/plans/${s.planId}`,
                '',
                'Llyner Leads',
              ].join('\n'),
            };
          }
          return event.type === 'RunCompleted'
            ? {
                to: owner.email,
                subject: `Your leads are ready: ${s.plan.name}`,
                text: [
                  `Hi ${owner.name},`,
                  '',
                  `${s.leadsDelivered} leads are ready for "${s.plan.name}".`,
                  `Credits spent: ${s.creditsSpent}.`,
                  '',
                  `See your leads: ${app}/app/plans/${s.planId}/leads`,
                  '',
                  'Llyner Leads',
                ].join('\n'),
              }
            : {
                to: owner.email,
                subject: "Your research run didn't finish",
                text: [
                  `Hi ${owner.name},`,
                  '',
                  `Your research run for "${s.plan.name}" didn't finish. ${FAILURE_IN_PLAIN_WORDS[s.failureCode ?? 'INTERNAL_ERROR']}`,
                  `You were charged ${s.creditsSpent} credits.`,
                  '',
                  `Open your Plan to try again: ${app}/app/plans/${s.planId}`,
                  '',
                  'Llyner Leads',
                ].join('\n'),
              };
        },
      });
    }
    if (event.type === 'RunFailed') {
      messages.push({
        to: 'support',
        message: async () => {
          const { supportEmail } = await this.deps.settings.support();
          if (!supportEmail) return null;
          const [business] = await this.deps.identity.getBusinesses([s.businessId]);
          return {
            to: supportEmail,
            subject: `Research run failed: ${s.plan.name} (${business?.name ?? s.businessId})`,
            text: [
              `Run ${s.id} failed with ${s.failureCode ?? 'INTERNAL_ERROR'} after ${s.attempts} attempt(s).`,
              `Business: ${business?.name ?? s.businessId}. Plan: ${s.plan.name}.`,
              `Started by: ${s.startedByStaffId ? 'Staff (Acting as)' : 'Owner'}.`,
              `Leads delivered: ${s.leadsDelivered}. Credits charged: ${s.creditsSpent}.`,
              '',
              `Run detail: ${app}/app/staff/runs/${s.id}`,
            ].join('\n'),
          };
        },
      });
    }
    for (const m of messages) await this.sendOnce(event.eventId, s.id, m.to, m.message);
  }

  private async sendOnce(
    eventId: string,
    runId: string,
    to: Recipient,
    build: () => Promise<EmailMessage | null>,
  ): Promise<void> {
    const message = await build();
    if (!message) return;
    const claimed = await this.deps.store.transaction((tx) =>
      tx.emails.claim(eventId, to, runId, this.deps.clock.now()),
    );
    if (!claimed) return;
    try {
      await this.deps.email.send(message);
    } catch (error) {
      // Let the queue retry (5 tries, FR-22): give the claim back first.
      await this.deps.store.transaction((tx) => tx.emails.unclaim(eventId, to));
      throw error;
    }
  }
}
