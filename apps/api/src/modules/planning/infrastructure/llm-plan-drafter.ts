import { z } from 'zod';
import {
  LlmUnavailableError,
  type LlmClient,
  type LlmToolSpec,
} from '../../../shared/application/llm-client.js';
import type { PlanDraft } from '../domain/draft.js';
import type { PlanDrafter, ProfileView } from '../application/ports.js';

export const DRAFT_PLAN_TOOL = 'draft_plan';
export const DRAFT_PURPOSE = 'planning.draft';

const SYSTEM = `You turn a small B2B supplier's goal into a research plan for finding local businesses that could buy from them.
Call the ${DRAFT_PLAN_TOOL} tool exactly once.
- name: a short plan name (at most 60 characters), e.g. "Bakeries near Austin".
- segments: 1 to 5 kinds of buyer. Each has a plain name (e.g. "Bakeries"), 1 to 6 fit signals (observable facts that make a business a better fit, e.g. "Bakes on site"), 0 to 5 exclusions (e.g. "Chain bakeries"), and productId: the id of the Product from the list that this kind of buyer would most likely buy.
- place: only if the goal names a place other than the business's own address (e.g. "near Fredericksburg"); otherwise null.
- radiusMiles: only if the goal states a distance (convert kilometres to miles); otherwise null.
Use only the Products listed. Write in plain English.`;

export const draftPlanTool: LlmToolSpec = {
  name: DRAFT_PLAN_TOOL,
  description: 'Record the drafted research plan.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'segments', 'place', 'radiusMiles'],
    properties: {
      name: { type: 'string', maxLength: 60 },
      segments: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'fitSignals', 'exclusions', 'productId'],
          properties: {
            name: { type: 'string', maxLength: 60 },
            fitSignals: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
            exclusions: { type: 'array', maxItems: 5, items: { type: 'string' } },
            productId: { type: 'string' },
          },
        },
      },
      place: { type: ['string', 'null'] },
      radiusMiles: { type: ['number', 'null'] },
    },
  },
};

const toolInput = z.object({
  name: z.string().default(''),
  segments: z.array(
    z.object({
      name: z.string(),
      fitSignals: z.array(z.string()),
      exclusions: z.array(z.string()).default([]),
      productId: z.string(),
    }),
  ),
  place: z.string().nullish(),
  radiusMiles: z.number().nullish(),
});

function userMessage(goal: string, profile: ProfileView): string {
  const products = profile.products
    .map((p) => `- id ${p.id}: ${p.name}${p.description ? ` (${p.description})` : ''}`)
    .join('\n');
  return [
    `Goal: ${goal}`,
    `Products:\n${products}`,
    `Business address: ${profile.location?.label ?? 'unknown'}`,
    `Delivery radius: ${profile.deliveryRadiusMiles ?? 'unknown'} miles`,
  ].join('\n\n');
}

/** PlanDrafter on the planning model, with structured output through one tool call (FR-16). */
export class LlmPlanDrafter implements PlanDrafter {
  constructor(private readonly llm: LlmClient) {}

  async draft(input: { goal: string; profile: ProfileView }): Promise<PlanDraft> {
    const response = await this.llm.complete({
      role: 'planning',
      system: SYSTEM,
      messages: [{ role: 'user', content: userMessage(input.goal, input.profile) }],
      tools: [draftPlanTool],
      maxTokens: 1500,
      purpose: DRAFT_PURPOSE,
    });
    if (response.toolCall?.name !== DRAFT_PLAN_TOOL) {
      throw new LlmUnavailableError('The planning model returned no plan');
    }
    const parsed = toolInput.safeParse(response.toolCall.input);
    if (!parsed.success)
      throw new LlmUnavailableError('The planning model returned an invalid plan');
    const { name, segments, place, radiusMiles } = parsed.data;
    const trimmedPlace = place?.trim() ?? '';
    return {
      name,
      segments,
      place: trimmedPlace.length > 0 ? trimmedPlace : null,
      radiusMiles: radiusMiles ?? null,
    };
  }
}
