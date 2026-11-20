import type { PlanSnapshot } from '../../domain/run.js';
import type { HandoffValues } from '../ports.js';

/**
 * Agent prompts, version 1 (PRD section 9: prompts are versioned files; the run records the
 * version). A new attempt's first prompt is built from the plan, the Step goal and the handoff,
 * never from an old transcript (FR-36, ADR 0017).
 */
export const PROMPT_VERSION = 'research.v1';

/** Marks the machine-readable state line in each user message. */
export const STATE_MARKER = 'STATE:';

export const MAX_NOTES_CHARS = 2_000;

export function systemPrompt(step: { name: string }): string {
  return [
    `You are the research agent of Llyner Leads, working on the "${step.name}" Step of a Research run.`,
    'You find local businesses (B2B public data only) that are likely to buy what the customer sells.',
    'Each turn, call exactly one tool. Work on the items listed in STATE (use their "id" as "item").',
    'Never invent facts: record only what a tool returned. Never collect data about private individuals beyond business contacts.',
    `Every tool accepts "notes": your working notes (max ${MAX_NOTES_CHARS} characters) for whoever continues this work: what you learned, what worked, what to try next. Keep them short and current.`,
    'Call finish_step when the Step is done or nothing useful is left to do.',
  ].join('\n');
}

function planBlock(plan: PlanSnapshot): string {
  const segments = plan.segments
    .map(
      (s) =>
        `- ${s.name} (id ${s.id}); fit signals: ${s.fitSignals.join('; ') || 'none'}; exclusions: ${s.exclusions.join('; ') || 'none'}; Product to pitch: ${s.productName ?? s.productId} (id ${s.productId})`,
    )
    .join('\n');
  const a = plan.searchArea;
  return [
    `Plan: ${plan.name}`,
    `Goal: ${plan.goal}`,
    `Search area: ${a.label} (${a.lat}, ${a.lng}), radius ${a.radiusMiles} miles`,
    `Max leads: ${plan.guardrails.maxLeads}; minimum Fit score: ${plan.guardrails.minFitScore}`,
    'Target segments:',
    segments,
  ].join('\n');
}

function handoffBlock(handoff: HandoffValues | null, notes: string): string {
  const lines: string[] = [];
  if (handoff) {
    lines.push(
      `A previous attempt stopped in Step "${handoff.stepKey}" after ${handoff.itemsDone} items (${handoff.itemsLeft} left).`,
    );
    if (handoff.lastError) lines.push(`Its last error: ${handoff.lastError}`);
    lines.push('Work already stored is reused; continue with the items left.');
  }
  if (notes) lines.push(`Notes so far:\n${notes}`);
  return lines.join('\n');
}

export function stateLine(state: Record<string, unknown>): string {
  return `${STATE_MARKER} ${JSON.stringify(state)}`;
}

/** The first message of a Step's agent session. */
export function firstPrompt(props: {
  plan: PlanSnapshot;
  step: { key: string; name: string; goal: string; doneWhen: string };
  tools: readonly string[];
  handoff: HandoffValues | null;
  notes: string;
  state: Record<string, unknown>;
}): string {
  const handoff = handoffBlock(props.handoff, props.notes);
  return [
    planBlock(props.plan),
    '',
    `Step: ${props.step.name}`,
    `Goal: ${props.step.goal}`,
    `Done when: ${props.step.doneWhen}`,
    `Tools: ${props.tools.join(', ')}`,
    ...(handoff ? ['', handoff] : []),
    '',
    stateLine(props.state),
  ].join('\n');
}

/** The message after each tool call: its result and the new state. */
export function turnPrompt(result: unknown, state: Record<string, unknown>): string {
  return [`Result: ${JSON.stringify(result).slice(0, 8_000)}`, '', stateLine(state)].join('\n');
}

/** Reads the state line of a user message (the fake research agent uses it). */
export function readState(message: string): Record<string, unknown> | null {
  const line = message.split('\n').find((l) => l.startsWith(STATE_MARKER));
  if (!line) return null;
  try {
    const parsed: unknown = JSON.parse(line.slice(STATE_MARKER.length).trim());
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
