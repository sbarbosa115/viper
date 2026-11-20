import type { LlmRequest, LlmResponse } from '../../application/llm-client.js';
import { fakePlanDraft } from './fake-plan-draft.js';
import { fakeWelcomeChat } from './fake-welcome-chat.js';

/**
 * TOOLS_MODE=fake answers for the shared purposes: planning's Plan drafts (`planning.draft`) and
 * the welcome chat (everything else). Module-specific fakes (research's agent) are routed in the
 * composition root before falling back to this.
 */
export function fakeModeAnswer(request: LlmRequest): Partial<LlmResponse> {
  return request.purpose === 'planning.draft' ? fakePlanDraft(request) : fakeWelcomeChat(request);
}
