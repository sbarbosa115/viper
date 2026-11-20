import type { Lead } from '@app/contracts/leads';
import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import { feedbackOf, type FeedbackValue } from '../domain/lead.js';
import type { LeadsUnitOfWork } from './ports.js';
import { assertCanUseLeads, leadNotFound, leadOf } from './views.js';

/** FR-27: "Good lead" / "Not a fit" (optional reason), changed or cleared with `value: null`. */
export class SetLeadFeedback {
  constructor(
    private readonly deps: { uow: LeadsUnitOfWork; clock: Clock; analytics: AnalyticsTracker },
  ) {}

  async execute(
    actor: Actor,
    leadId: string,
    input: { value: FeedbackValue | null; reason?: string | undefined },
  ): Promise<Lead> {
    assertCanUseLeads(actor);
    const feedback = feedbackOf(input.value, input.reason);
    const updated = await this.deps.uow.run(async ({ leads }) => {
      const [lead] = await leads.findMany(actor.businessId, [leadId]);
      if (!lead) throw leadNotFound(leadId);
      const at = this.deps.clock.now();
      await leads.saveFeedback(lead.id, feedback, at);
      return {
        ...lead,
        feedback: feedback?.value ?? null,
        feedbackReason: feedback?.reason ?? null,
        feedbackAt: feedback ? at : null,
      };
    });
    if (feedback) {
      await this.deps.analytics.track({
        name: 'lead_feedback_given',
        actor,
        properties: {
          lead_id: updated.id,
          run_id: updated.runId,
          value: feedback.value,
          fit_score: updated.fitScore,
        },
      });
    }
    return leadOf(updated);
  }
}
