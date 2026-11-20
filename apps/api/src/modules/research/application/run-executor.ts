import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type {
  LlmMessage,
  LlmResponse,
  LlmToolSpec,
} from '../../../shared/application/llm-client.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import { claudeTool, isClaudeTool, type FlowStepDefinition } from '../domain/flow.js';
import {
  activeTimeUsed,
  collectionStop,
  stepAllowanceMillicredits,
  stepTimeUsed,
} from '../domain/guardrails.js';
import { COLLECTION_STEPS, TOOL_KEYS } from '../domain/local-buyers.js';
import type { ResearchRun, RunFailureCode } from '../domain/run.js';
import {
  asRecord,
  asString,
  asStrings,
  type StepContext,
  type WorkItem,
} from './agent/step-context.js';
import { stepSpecs, type AgentStep, type DeterministicStep, type StepSpec } from './agent/steps.js';
import { TOOL_KINDS } from './agent/tool-kinds.js';
import type {
  AttemptRecord,
  BillingPort,
  HandoffRecord,
  Heartbeat,
  ProspectStorePort,
  ResearchStore,
  ResearchTx,
  RunMessageRecord,
  RunQueue,
  Sleeper,
  StepProgress,
  StepRecord,
  StopHook,
  ToolCatalogPort,
  ToolRunnerPort,
} from './ports.js';
import { firstPrompt, MAX_NOTES_CHARS, systemPrompt, turnPrompt } from './prompts/v1.js';
import {
  BUDGET_TOOL_ERRORS,
  BudgetExhaustedSignal,
  CancelRequestedSignal,
  FinalRunError,
  LeaseLostError,
  PROVIDER_BACKOFF_MS,
  RETRYABLE_TOOL_ERRORS,
  RetryableRunError,
  TOOL_OFF_ERRORS,
  WorkerStopSignal,
} from './run-errors.js';
import {
  concludeAttempt,
  finishRun,
  handoffValues,
  trackRunFinished,
  type AttemptConclusion,
} from './run-lifecycle.js';

export interface ExecutorDeps {
  store: ResearchStore;
  tools: ToolRunnerPort;
  catalog: ToolCatalogPort;
  prospects: ProspectStorePort;
  billing: BillingPort;
  clock: Clock;
  ids: IdGenerator;
  sleeper: Sleeper;
  analytics: AnalyticsTracker;
  queue: RunQueue;
  /** This worker's id, written as the attempt's lease owner. */
  workerId: string;
  /**
   * FR-20 provider retries done here (default 1 s, 4 s, 16 s). Pass `[]` when the ToolRunner
   * already retries (the tools module does).
   */
  retryDelaysMs?: readonly number[];
  /** Test-only (ENABLE_TEST_HOOKS): stop mid-Step as if the worker crashed (AJ-9). */
  stopHook?: StopHook;
  /** Renews the lease every 30 s while an attempt runs (FR-36); none in unit tests. */
  heartbeat?: Heartbeat;
  logger?: { warn(obj: object, msg: string): void };
}

/** FR-36: the worker holding an attempt renews its lease every 30 s. */
export const LEASE_RENEW_MS = 30_000;

export type AttemptResult =
  | 'completed'
  | 'retryable_error'
  | 'final_error'
  | 'cancelled'
  /** Nothing to do: the run is not queued or retrying (a duplicate job). */
  | 'skipped'
  /** The sweeper took the attempt over; nothing was written. */
  | 'lease_lost'
  /** The test hook stopped the worker; the attempt is left for the sweeper. */
  | 'stopped';

const FINISH_STEP = 'finish_step';
const SESSION_TAIL = 6;
const MAX_IDLE_TURNS = 3;
const LLM_TIMEOUT_MS = 90_000;
/** Work items one agent turn may hand to a provider Tool. */
const MAX_BATCH = 10;

const emptyProgress = (): StepProgress => ({
  done: [],
  total: 0,
  okCalls: 0,
  failedCalls: 0,
  activeSeconds: 0,
  stoppedBy: null,
  data: {},
});

/** Anthropic tool names allow letters, digits, `_` and `-`: `google.places` → `google__places`. */
export const llmToolName = (toolKey: string): string => toolKey.replaceAll('.', '__');
const toolKeyOf = (name: string): string => name.replaceAll('__', '.');

function leaseUntil(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Runs one attempt of a Research run (FR-19, FR-20, FR-36): claims it with a lease, runs the
 * flow's Steps in order from the first unfinished one, and ends the attempt. Each Step is an
 * agent loop on Claude (or deterministic code for Merge and Deliver); progress, the handoff and
 * the Tool call record are saved together after every Tool call.
 */
export class RunExecutor {
  private readonly specs: ReadonlyMap<string, StepSpec>;

  constructor(private readonly deps: ExecutorDeps) {
    this.specs = stepSpecs({
      instagram: TOOL_KEYS.instagram,
      yelp: TOOL_KEYS.yelp,
      zerobounce: TOOL_KEYS.zerobounce,
      twilio: TOOL_KEYS.twilio,
    });
  }

  async runAttempt(runId: string): Promise<AttemptResult> {
    const claim = await this.claim(runId);
    if (!claim) return 'skipped';
    const session = new AttemptSession(this.deps, this.specs, claim);
    const lease = claim.run.settings.workerStoppedAfterMinutes;
    const stop = this.deps.heartbeat?.start(async () => {
      await this.renewLease(runId, claim.attempt.n, lease);
    }, LEASE_RENEW_MS);
    try {
      return await session.execute();
    } finally {
      stop?.();
    }
  }

  /** Extends the lease of a running attempt (the worker calls this every 30 s). */
  renewLease(runId: string, attemptN: number, minutes: number): Promise<boolean> {
    return this.deps.store.transaction((tx) =>
      tx.attempts.renewLease(
        runId,
        attemptN,
        this.deps.workerId,
        leaseUntil(this.deps.clock.now(), minutes),
      ),
    );
  }

  private claim(runId: string): Promise<Claim | null> {
    return this.deps.store.transaction(async (tx) => {
      const run = await tx.runs.findForUpdate(runId);
      if (!run || (run.status !== 'queued' && run.status !== 'retrying')) return null;
      const now = this.deps.clock.now();
      const steps = await tx.steps.list(runId);
      const handoff = await tx.handoffs.get(runId);
      const n = run.beginAttempt(now);
      const open = steps.find((s) => s.status !== 'done' && s.status !== 'skipped');
      const attempt: AttemptRecord = {
        id: this.deps.ids.next(),
        runId,
        n,
        status: 'running',
        fromStep: open?.key ?? steps[steps.length - 1]?.key ?? 'search-terms',
        fromItem: open?.progress?.done.length ?? 0,
        reachedStep: null,
        reachedItem: null,
        error: null,
        handoff: null,
        leaseOwner: this.deps.workerId,
        leaseExpiresAt: leaseUntil(now, run.settings.workerStoppedAfterMinutes),
        startedAt: now,
        endedAt: null,
        activeSeconds: 0,
      };
      await tx.attempts.insert(attempt);
      await tx.runs.save(run);
      return { run, steps, handoff, attempt };
    });
  }
}

interface Claim {
  run: ResearchRun;
  steps: StepRecord[];
  handoff: HandoffRecord | null;
  attempt: AttemptRecord;
}

interface Position {
  stepKey: string;
  itemsDone: number;
  itemsLeft: number;
}

/** One attempt's working state. Lives only while the attempt runs. */
class AttemptSession {
  private run: ResearchRun;
  private readonly steps: Map<string, StepRecord>;
  private readonly dirty = new Set<string>();
  private readonly checkpoints = new Map<string, Readonly<Record<string, unknown>>>();
  private readonly attempt: AttemptRecord;
  private readonly previous: HandoffRecord | null;
  private notes: string;
  private lastError: string | null = null;
  private position: Position;
  private pendingMessages: RunMessageRecord[] = [];
  private stopHook: { stepKey: string; items: number } | null = null;

  constructor(
    private readonly deps: ExecutorDeps,
    private readonly specs: ReadonlyMap<string, StepSpec>,
    claim: Claim,
  ) {
    this.run = claim.run;
    this.steps = new Map(claim.steps.map((s) => [s.key, s]));
    for (const s of claim.steps) if (s.checkpoint) this.checkpoints.set(s.key, s.checkpoint);
    this.attempt = claim.attempt;
    this.previous = claim.handoff;
    this.notes = claim.handoff?.notes ?? '';
    this.lastError = claim.handoff?.lastError ?? null;
    this.position = {
      stepKey: claim.attempt.fromStep,
      itemsDone: claim.attempt.fromItem,
      itemsLeft: claim.handoff?.itemsLeft ?? 0,
    };
  }

  async execute(): Promise<AttemptResult> {
    try {
      this.stopHook = (await this.deps.stopHook?.take()) ?? null;
      const defs = this.snapshot.flow.steps;
      for (let i = 0; i < defs.length; i += 1) {
        const def = defs[i];
        if (!def) continue;
        const rec = this.steps.get(def.key);
        if (rec && (rec.status === 'done' || rec.status === 'skipped')) continue;
        try {
          await this.runStep(i, def);
        } catch (error) {
          if (!(error instanceof BudgetExhaustedSignal)) throw error;
          await this.deliverWhatWeHave(i, error.message);
          break;
        }
      }
      return await this.complete();
    } catch (error) {
      return this.handle(error);
    }
  }

  /**
   * The budget can't pay for the next Tool call (FR-20 hard stop): the current Step ends, the
   * Steps left are skipped, and Deliver runs with what was found. With no Lead to deliver, the
   * run fails with INSUFFICIENT_CREDITS (final, FR-36).
   */
  private async deliverWhatWeHave(index: number, message: string): Promise<void> {
    this.lastError = message.slice(0, 1000);
    this.run.markBudgetReached();
    const deliver = this.specs.get('deliver');
    const defs = this.snapshot.flow.steps;
    const delivered =
      deliver?.kind === 'deterministic'
        ? await this.save(async (tx) => {
            const result = await deliver.run(this.context(), tx.handle);
            const n = result.leadsDelivered ?? 0;
            if (n === 0) return 0;
            // Leads were delivered: the run completes; the Steps it couldn't pay for are skipped.
            this.run.setLeadsDelivered(n);
            defs.forEach((def, i) => {
              const status = this.steps.get(def.key)?.status;
              if (i < index || status === 'done' || status === 'skipped') return;
              if (def.key === 'deliver')
                this.markStepEnded(def.key, 'done', null, result.checkpoint);
              else
                this.markStepEnded(
                  def.key,
                  i === index ? 'done' : 'skipped',
                  'budget_exhausted',
                  {},
                );
            });
            return n;
          })
        : 0;
    if (delivered === 0) {
      // Nothing to deliver: the run fails (free, FR-20); a resume continues from this Step.
      throw new FinalRunError('INSUFFICIENT_CREDITS', `The run's credits ran out: ${message}`);
    }
  }

  // Steps ----------------------------------------------------------------------------------------

  private get snapshot() {
    return this.run.toSnapshot();
  }

  private context(): StepContext {
    return {
      runId: this.run.id,
      businessId: this.run.businessId,
      attemptN: this.attempt.n,
      plan: this.snapshot.plan,
      prospects: this.deps.prospects,
      analytics: this.deps.analytics,
      checkpoints: this.checkpoints,
      now: () => this.deps.clock.now(),
    };
  }

  private step(key: string): StepRecord {
    const rec = this.steps.get(key);
    if (!rec) throw new FinalRunError('INVALID_PLAN', `The run has no "${key}" step`);
    return rec;
  }

  private setStep(rec: StepRecord): void {
    this.steps.set(rec.key, rec);
    this.dirty.add(rec.key);
  }

  private async runStep(index: number, def: FlowStepDefinition): Promise<void> {
    const spec = this.specs.get(def.key);
    if (!spec) throw new FinalRunError('INVALID_PLAN', `Unknown step "${def.key}"`);
    const rec = this.step(def.key);
    this.position = {
      stepKey: def.key,
      itemsDone: rec.progress?.done.length ?? 0,
      itemsLeft: Math.max(0, (rec.progress?.total ?? 0) - (rec.progress?.done.length ?? 0)),
    };
    this.checkHardLimits();

    if (COLLECTION_STEPS.includes(def.key) && this.collectionStopped()) {
      await this.endStep(def.key, 'skipped', 'collection_stopped');
      return;
    }

    const usable = await this.usableTools(def, spec);
    const providers = def.tools.filter((t) => !isClaudeTool(t));
    const missing =
      (providers.length > 0 && usable.providers.length === 0) ||
      (spec.kind === 'agent' && !usable.claude);
    if (missing) {
      if (!def.required) {
        await this.endStep(def.key, 'skipped', 'tools_unavailable');
        return;
      }
      throw new FinalRunError('PROVIDER_NOT_CONFIGURED', `No Tool of "${def.name}" is available`);
    }

    const now = this.deps.clock.now();
    this.setStep({
      ...rec,
      status: 'running',
      attempts: rec.attempts + 1,
      startedAt: rec.startedAt ?? now,
      progress: rec.progress ?? emptyProgress(),
    });
    // The working screen shows the current Step (FR-21).
    await this.save(() => Promise.resolve());
    if (spec.kind === 'deterministic') await this.runDeterministic(spec);
    else await this.runAgent(index, def, spec, usable.providers);
  }

  private async usableTools(
    def: FlowStepDefinition,
    spec: StepSpec,
  ): Promise<{ providers: string[]; claude: boolean }> {
    const claude = spec.kind === 'agent' ? this.claudeKey(def, spec) : null;
    const keys = [...new Set([...def.tools, ...(claude ? [claude] : [])])];
    if (keys.length === 0) return { providers: [], claude: false };
    const availability = await this.deps.catalog.availability(keys);
    const providers = def.tools.filter(
      (t) =>
        !isClaudeTool(t) &&
        TOOL_KINDS[t] !== undefined &&
        availability.get(t) === true &&
        !this.run.isToolDisabled(t),
    );
    return { providers, claude: claude !== null && availability.get(claude) === true };
  }

  /** The Step's model: the Claude Tool it lists, else the planning model (FR-19). */
  private claudeKey(def: FlowStepDefinition, spec: AgentStep): string {
    return def.tools.find(isClaudeTool) ?? claudeTool(spec.role);
  }

  private get retryDelays(): readonly number[] {
    return this.deps.retryDelaysMs ?? PROVIDER_BACKOFF_MS;
  }

  private async runDeterministic(spec: DeterministicStep): Promise<void> {
    await this.save(async (tx) => {
      const result = await spec.run(this.context(), tx.handle);
      if (result.leadsDelivered !== undefined) this.run.setLeadsDelivered(result.leadsDelivered);
      this.markStepEnded(spec.key, 'done', null, result.checkpoint);
    });
  }

  private async endStep(
    key: string,
    status: 'done' | 'skipped',
    reason: string | null,
  ): Promise<void> {
    await this.save(() => {
      this.markStepEnded(key, status, reason, status === 'skipped' ? { skipped: reason } : {});
      return Promise.resolve();
    });
  }

  private markStepEnded(
    key: string,
    status: 'done' | 'skipped',
    reason: string | null,
    checkpoint: Record<string, unknown>,
  ): void {
    const rec = this.step(key);
    const progress = rec.progress ?? emptyProgress();
    this.setStep({
      ...rec,
      status,
      finishedAt: this.deps.clock.now(),
      checkpoint,
      progress: reason ? { ...progress, stoppedBy: progress.stoppedBy ?? reason } : progress,
    });
    this.checkpoints.set(key, checkpoint);
  }

  // The agent loop -------------------------------------------------------------------------------

  private async runAgent(
    index: number,
    def: FlowStepDefinition,
    spec: AgentStep,
    providers: readonly string[],
  ): Promise<void> {
    const ctx = this.context();
    const items = await spec.planItems(ctx);
    const byId = new Map(items.map((it) => [it.id, it]));
    const start = this.step(def.key).progress ?? emptyProgress();
    const done = new Set(start.done);
    const failedPairs = new Set<string>();
    const stepStartedAt = this.deps.clock.now();
    let progress: StepProgress = {
      ...start,
      total: done.size + items.filter((it) => !done.has(it.id)).length,
    };
    const off: { code: RunFailureCode | null } = { code: null };

    const liveProviders = () => providers.filter((t) => !this.run.isToolDisabled(t));
    const toolsFor = (it: WorkItem) =>
      liveProviders().filter((t) => !it.tools || it.tools.includes(t));
    const exhausted = (it: WorkItem) =>
      providers.length > 0 && toolsFor(it).every((t) => failedPairs.has(`${it.id}|${t}`));
    const left = () => items.filter((it) => !done.has(it.id) && !exhausted(it));
    const stepSeconds = () =>
      start.activeSeconds + (this.deps.clock.now().getTime() - stepStartedAt.getTime()) / 1000;

    const commitProgress = (patch: Partial<StepProgress> = {}) => {
      const remaining = left().length;
      progress = {
        ...progress,
        ...patch,
        done: [...done],
        activeSeconds: Math.round(stepSeconds()),
      };
      this.setStep({ ...this.step(def.key), progress });
      this.position = { stepKey: def.key, itemsDone: done.size, itemsLeft: remaining };
    };

    let lastResult: unknown = null;
    const state = () => ({
      step: def.key,
      itemsDone: done.size,
      itemsLeft: left().length,
      nextItems: left()
        .slice(0, spec.itemsShown)
        .map((it) => ({
          id: it.id,
          label: it.label,
          data: it.data,
          ...(it.tools ? { tools: it.tools.map(llmToolName) } : {}),
        })),
      tools: [
        ...liveProviders().map(llmToolName),
        ...spec.internalTools.map((t) => t.name),
        FINISH_STEP,
      ],
      budgetLeftCredits: Math.floor(this.run.remainingMillicredits / 1000),
      lastResult,
    });

    const llmTools = this.llmTools(spec, providers);
    const session: LlmMessage[] = [];
    const opening = firstPrompt({
      plan: ctx.plan,
      step: { key: def.key, name: def.name, goal: spec.goal, doneWhen: spec.doneWhen },
      tools: llmTools.map((t) => t.name),
      handoff:
        this.previous && this.previous.attemptN < this.attempt.n
          ? handoffValues(this.previous)
          : null,
      notes: this.notes,
      state: state(),
    });
    session.push({ role: 'user', content: opening });
    this.queueMessage(def.key, 'user', opening);
    commitProgress();

    let turns = 0;
    let idle = 0;
    const maxTurns = items.length * 4 + 10;
    for (;;) {
      if (left().length === 0) break;
      if (spec.enough?.(progress.data ?? {})) break;
      if (providers.length > 0 && liveProviders().length === 0) {
        off.code ??= 'PROVIDER_ERROR';
        break;
      }
      this.checkHardLimits();
      const stop = this.stepStop(index, def, stepSeconds());
      if (stop) {
        commitProgress({ stoppedBy: stop });
        break;
      }
      if (turns >= maxTurns || idle >= MAX_IDLE_TURNS) {
        commitProgress({ stoppedBy: 'agent_stopped' });
        break;
      }
      turns += 1;

      const response = await this.ask(spec, def, session, llmTools);
      const call = response.toolCall;
      if (!call) {
        idle += 1;
        lastResult = { error: 'Call exactly one tool.' };
        const nudge = turnPrompt(lastResult, state());
        session.push(
          { role: 'assistant', content: response.text || '(no tool call)' },
          { role: 'user', content: nudge },
        );
        this.queueMessage(def.key, 'assistant', response.text);
        this.queueMessage(def.key, 'user', nudge);
        continue;
      }
      idle = 0;
      const input = asRecord(call.input);
      this.takeNotes(input.notes);
      this.queueMessage(def.key, 'assistant', { tool: call.name, input });
      if (call.name === FINISH_STEP) {
        await this.save(() => {
          commitProgress({ stoppedBy: progress.stoppedBy ?? null });
          return Promise.resolve();
        });
        break;
      }

      const internal = spec.internalTools.find((t) => t.name === call.name);
      const toolKey = toolKeyOf(call.name);
      if (internal) {
        lastResult = await this.save(async (tx) => {
          const r = await internal.apply({
            ctx,
            input,
            items: byId,
            data: progress.data ?? {},
            within: tx.handle,
          });
          if (typeof r === 'string') {
            commitProgress();
            return { tool: call.name, error: r };
          }
          for (const id of r.itemsDone) if (byId.has(id)) done.add(id);
          commitProgress({ data: { ...progress.data, ...r.data } });
          return { tool: call.name, result: r.view };
        });
      } else if (liveProviders().includes(toolKey)) {
        // One turn may name several work items: one Tool call (and save) per item.
        const requested = [...asStrings(input.items), ...asStrings([input.item])].slice(
          0,
          MAX_BATCH,
        );
        const results: Record<string, unknown>[] = [];
        for (const id of requested.length ? requested : ['']) {
          const item = byId.get(id);
          const kind = TOOL_KINDS[toolKey];
          const refusal =
            !item || done.has(item.id)
              ? 'Unknown or finished work item: use ids from nextItems'
              : !toolsFor(item).includes(toolKey)
                ? `Use ${toolsFor(item).map(llmToolName).join(' or ')} for this item`
                : null;
          const runnerInput =
            item && kind && !refusal
              ? kind.runnerInput(input, item, ctx)
              : (refusal ?? 'Unknown tool');
          if (typeof runnerInput === 'string' || !item || !kind) {
            results.push(
              await this.save(() => {
                commitProgress();
                return Promise.resolve({ item: id, status: 'error', error: runnerInput });
              }),
            );
            continue;
          }
          const outcome = await this.callProvider(def, toolKey, item, runnerInput, {
            onOk: (data, itemDone) => {
              if (itemDone) done.add(item.id);
              commitProgress({
                okCalls: progress.okCalls + 1,
                data: { ...progress.data, ...data },
              });
            },
            onFailed: () => {
              failedPairs.add(`${item.id}|${toolKey}`);
              commitProgress({ failedCalls: progress.failedCalls + 1 });
            },
            onOff: (code) => {
              if (code === 'PROVIDER_NOT_CONFIGURED') off.code = 'PROVIDER_NOT_CONFIGURED';
              else off.code ??= 'PROVIDER_ERROR';
              commitProgress();
            },
          });
          results.push({ item: item.id, ...outcome });
          this.checkStopHook();
          if (!liveProviders().includes(toolKey)) break;
        }
        lastResult = { tool: call.name, results };
      } else {
        lastResult = await this.save(() => {
          commitProgress();
          return Promise.resolve({
            tool: call.name,
            error: 'This tool is not available in this Step',
          });
        });
      }
      const next = turnPrompt(lastResult, state());
      session.push(
        { role: 'assistant', content: JSON.stringify({ tool: call.name, input }) },
        { role: 'user', content: next },
      );
      this.queueMessage(def.key, 'user', next);
      this.checkStopHook();
    }

    if (
      def.required &&
      providers.length > 0 &&
      progress.okCalls === 0 &&
      (progress.failedCalls > 0 || off.code)
    ) {
      const code =
        off.code === 'PROVIDER_NOT_CONFIGURED' ? 'PROVIDER_NOT_CONFIGURED' : 'PROVIDER_ERROR';
      const message = `No successful Tool call in "${def.name}"${this.lastError ? ` (${this.lastError})` : ''}`;
      if (code === 'PROVIDER_NOT_CONFIGURED') throw new FinalRunError(code, message);
      throw new RetryableRunError(code, message);
    }
    const checkpoint = await spec.finish(ctx, progress.data ?? {});
    await this.save(() => {
      commitProgress();
      this.markStepEnded(def.key, 'done', null, checkpoint);
      return Promise.resolve();
    });
  }

  private llmTools(spec: AgentStep, providers: readonly string[]): LlmToolSpec[] {
    const notes = {
      type: 'string',
      maxLength: MAX_NOTES_CHARS,
      description: 'Your working notes (replace the previous ones)',
    };
    const tools: LlmToolSpec[] = providers.map((key) => {
      const kind = TOOL_KINDS[key];
      return {
        name: llmToolName(key),
        description: kind?.description ?? key,
        inputSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: MAX_BATCH,
              description: 'Work item ids from nextItems (one Tool call each)',
            },
            ...kind?.params,
            notes,
          },
          required: ['items', ...(kind?.required ?? [])],
        },
      };
    });
    for (const t of spec.internalTools) {
      tools.push({
        name: t.name,
        description: t.description,
        inputSchema: {
          type: 'object',
          properties: { ...t.params, notes },
          required: [...t.required],
        },
      });
    }
    tools.push({
      name: FINISH_STEP,
      description: 'End this Step: its done-when is met or nothing useful is left.',
      inputSchema: { type: 'object', properties: { notes }, required: [] },
    });
    return tools;
  }

  /**
   * One agent turn: Claude is called through the ToolRunner (metered by tokens, stored with the
   * handoff, reused by input hash). Unavailable is retried with backoff, then ends the attempt.
   */
  private async ask(
    spec: AgentStep,
    def: FlowStepDefinition,
    session: readonly LlmMessage[],
    tools: readonly LlmToolSpec[],
  ): Promise<LlmResponse> {
    const [first, ...rest] = session;
    const tail = rest.slice(-SESSION_TAIL);
    const messages = first ? [first, ...(tail[0]?.role === 'user' ? tail.slice(1) : tail)] : tail;
    const toolKey = this.claudeKey(def, spec);
    const input = {
      system: systemPrompt(def),
      messages,
      tools,
      maxTokens: 2_000,
      timeoutMs: LLM_TIMEOUT_MS,
      purpose: `research.step.${def.key}`,
    };
    for (let tryN = 0; ; tryN += 1) {
      const outcome = await this.save(async (tx) => {
        const result = await this.deps.tools.call({
          businessId: this.run.businessId,
          runId: this.run.id,
          stepKey: def.key,
          attemptN: this.attempt.n,
          toolKey,
          input,
          budget: { remainingMillicredits: this.run.remainingMillicredits },
          within: tx.handle,
        });
        this.spend(def.key, result.millicredits, result.providerCostMicros ?? 0);
        if (result.status === 'ok') return { response: toLlmResponse(result.output) };
        const code = result.error?.code ?? 'PROVIDER_ERROR';
        const message = `Claude: ${result.error?.message ?? code}`;
        if (BUDGET_TOOL_ERRORS.includes(code)) throw new BudgetExhaustedSignal(message);
        if (TOOL_OFF_ERRORS.includes(code))
          throw new FinalRunError('PROVIDER_NOT_CONFIGURED', message);
        this.lastError = message.slice(0, 1000);
        const retryable = result.error?.retryable ?? RETRYABLE_TOOL_ERRORS.includes(code);
        return { response: null, wait: retryable ? this.retryDelays[tryN] : undefined };
      });
      if (outcome.response) return outcome.response;
      if (outcome.wait === undefined) {
        throw new RetryableRunError('PROVIDER_ERROR', this.lastError ?? 'Claude is unavailable');
      }
      await this.deps.sleeper.sleep(outcome.wait);
    }
  }

  /** One provider Tool call with FR-20 retries (1 s, 4 s, 16 s); each try is saved on its own. */
  private async callProvider(
    def: FlowStepDefinition,
    toolKey: string,
    item: WorkItem,
    input: Record<string, unknown>,
    on: {
      onOk(data: Readonly<Record<string, unknown>>, itemDone: boolean): void;
      onFailed(): void;
      onOff(code: string): void;
    },
  ): Promise<Record<string, unknown>> {
    const kind = TOOL_KINDS[toolKey];
    if (!kind) return { error: 'Unknown tool' };
    for (let tryN = 0; ; tryN += 1) {
      const outcome = await this.save(async (tx) => {
        const result = await this.deps.tools.call({
          businessId: this.run.businessId,
          runId: this.run.id,
          stepKey: def.key,
          attemptN: this.attempt.n,
          toolKey,
          input,
          budget: { remainingMillicredits: this.run.remainingMillicredits },
          within: tx.handle,
        });
        this.spend(def.key, result.millicredits, result.providerCostMicros ?? 0);
        if (result.status === 'ok') {
          this.run.recordToolSuccess(toolKey);
          const effect = await kind.effect({
            ctx: this.context(),
            toolKey,
            item,
            output: result.output,
            within: tx.handle,
          });
          on.onOk(effect.data ?? {}, effect.itemDone);
          return {
            kind: 'ok' as const,
            view: { status: 'ok', reused: result.reused, output: effect.view },
          };
        }
        const code =
          result.error?.code ?? (result.status === 'skipped' ? 'TOOL_DISABLED' : 'PROVIDER_ERROR');
        const message = result.error?.message ?? code;
        if (BUDGET_TOOL_ERRORS.includes(code)) {
          throw new BudgetExhaustedSignal(`${toolKey}: ${message}`);
        }
        if (TOOL_OFF_ERRORS.includes(code)) {
          this.run.disableTool(toolKey);
          on.onOff(code);
          return {
            kind: 'off' as const,
            view: { status: 'error', error: `${llmToolName(toolKey)} is not available` },
          };
        }
        this.lastError = `${toolKey}: ${message}`.slice(0, 1000);
        const { disabled } = this.run.recordToolFailure(toolKey);
        const retryable =
          (result.error?.retryable ?? RETRYABLE_TOOL_ERRORS.includes(code)) && !disabled;
        const wait = this.retryDelays[tryN];
        if (!retryable || wait === undefined) on.onFailed();
        return {
          kind: 'error' as const,
          wait: retryable ? wait : undefined,
          view: { status: 'error', error: message, ...(disabled ? { toolDisabled: true } : {}) },
        };
      });
      if (outcome.kind !== 'error' || outcome.wait === undefined) return outcome.view;
      await this.deps.sleeper.sleep(outcome.wait);
    }
  }

  private spend(stepKey: string, millicredits: number, providerCostMicros: number): void {
    this.run.addSpend(millicredits, providerCostMicros);
    const rec = this.step(stepKey);
    this.setStep({ ...rec, millicreditsSpent: rec.millicreditsSpent + millicredits });
  }

  private takeNotes(raw: unknown): void {
    const notes = asString(raw);
    if (notes) this.notes = notes.slice(0, MAX_NOTES_CHARS);
  }

  private queueMessage(stepKey: string, role: 'user' | 'assistant', content: unknown): void {
    this.pendingMessages.push({
      id: this.deps.ids.next(),
      runId: this.run.id,
      attemptN: this.attempt.n,
      stepKey,
      role,
      content: typeof content === 'string' ? { text: content } : content,
      createdAt: this.deps.clock.now(),
    });
  }

  // Guardrails -----------------------------------------------------------------------------------

  private elapsedSeconds(): number {
    return (this.deps.clock.now().getTime() - this.attempt.startedAt.getTime()) / 1000;
  }

  /** FR-20 hard stops: the flow's max active time and max total time fail the run (TIME_LIMIT). */
  private checkHardLimits(): void {
    const now = this.deps.clock.now();
    if (
      activeTimeUsed(this.run.settings, this.run.windowActiveSeconds(this.elapsedSeconds())) ||
      this.run.totalTimeUsed(now)
    ) {
      throw new FinalRunError('TIME_LIMIT', 'The run reached its time limit');
    }
  }

  /** FR-20: collection stops at 80% of max credits or 45 active minutes (flow settings). */
  private collectionStopped(): boolean {
    const s = this.snapshot;
    const stop = collectionStop({
      settings: s.flow.runSettings,
      spentMillicredits: s.millicreditsSpent,
      maxCredits: s.plan.guardrails.maxCredits,
      activeSeconds: this.run.windowActiveSeconds(this.elapsedSeconds()),
    });
    if (stop === 'budget') this.run.markBudgetReached();
    if (stop === 'time') this.run.markTimeReached();
    return stop !== null;
  }

  private stepStop(index: number, def: FlowStepDefinition, stepSeconds: number): string | null {
    if (this.run.remainingMillicredits <= 0) {
      throw new BudgetExhaustedSignal('The run used all its credits');
    }
    if (COLLECTION_STEPS.includes(def.key) && this.collectionStopped()) return 'collection_stopped';
    const defs = this.snapshot.flow.steps;
    const spentBefore = defs
      .slice(0, index)
      .reduce((sum, d) => sum + (this.steps.get(d.key)?.millicreditsSpent ?? 0), 0);
    const allowance = stepAllowanceMillicredits({
      steps: defs,
      index,
      maxCredits: this.snapshot.plan.guardrails.maxCredits,
      spentBefore,
      spentInStep: this.step(def.key).millicreditsSpent,
    });
    if (allowance <= 0) return 'budget_share';
    if (stepTimeUsed(def, stepSeconds)) return 'time_limit';
    return null;
  }

  // Saving ---------------------------------------------------------------------------------------

  private handoff(now: Date): HandoffRecord {
    const s = this.snapshot;
    return {
      runId: s.id,
      attemptN: this.attempt.n,
      stepKey: this.position.stepKey,
      itemsDone: this.position.itemsDone,
      itemsLeft: this.position.itemsLeft,
      notes: this.notes,
      lastError: this.lastError,
      creditsLeft: Math.floor(this.run.remainingMillicredits / 1000),
      activeSecondsLeft: Math.max(
        0,
        Math.round(
          s.flow.runSettings.maxActiveMinutes * 60 -
            this.run.windowActiveSeconds(this.elapsedSeconds()),
        ),
      ),
      updatedAt: now,
    };
  }

  /**
   * A save point (FR-19, FR-36): `work` (usually one Tool call, recorded by the ToolRunner in
   * this transaction) commits together with step progress, spend, the handoff and the agent's
   * messages. The lease is checked first (the sweeper may have ended the attempt) and renewed.
   */
  private async save<T>(work: (tx: ResearchTx) => Promise<T>): Promise<T> {
    const lease = this.run.settings.workerStoppedAfterMinutes;
    const owner = this.deps.workerId;
    const result = await this.deps.store.transaction(async (tx) => {
      const n = this.attempt.n;
      if (
        !(await tx.attempts.renewLease(
          this.run.id,
          n,
          owner,
          leaseUntil(this.deps.clock.now(), lease),
        ))
      ) {
        throw new LeaseLostError();
      }
      const value = await work(tx);
      const stored = await tx.runs.findForUpdate(this.run.id);
      if (stored) this.run.adoptCancelRequest(stored);
      await tx.runs.save(this.run);
      for (const key of this.dirty) await tx.steps.save(this.step(key));
      const now = this.deps.clock.now();
      await tx.handoffs.save(this.handoff(now));
      if (this.pendingMessages.length) await tx.messages.append(this.pendingMessages);
      await tx.attempts.renewLease(this.run.id, n, owner, leaseUntil(now, lease));
      return value;
    });
    this.dirty.clear();
    this.pendingMessages = [];
    if (this.run.cancelRequested) throw new CancelRequestedSignal();
    return result;
  }

  private checkStopHook(): void {
    const hook = this.stopHook;
    if (
      hook?.stepKey === this.position.stepKey &&
      this.position.itemsDone >= (hook?.items ?? Infinity)
    ) {
      throw new WorkerStopSignal();
    }
  }

  // Ending ---------------------------------------------------------------------------------------

  private async complete(): Promise<AttemptResult> {
    const now = this.deps.clock.now();
    const elapsed = this.elapsedSeconds();
    const ok = await this.deps.store.transaction(async (tx) => {
      if (!(await tx.attempts.renewLease(this.run.id, this.attempt.n, this.deps.workerId, now)))
        return false;
      const run = (await tx.runs.findForUpdate(this.run.id)) ?? this.run;
      run.addActiveSeconds(elapsed);
      await finishRun(tx, this.deps.billing, run, 'completed', null, now);
      const handoff = this.handoff(now);
      await tx.attempts.save({
        ...this.attempt,
        status: 'completed',
        endedAt: now,
        activeSeconds: Math.round(elapsed),
        reachedStep: handoff.stepKey,
        reachedItem: handoff.itemsDone,
        handoff: handoffValues(handoff),
        leaseExpiresAt: null,
      });
      await tx.handoffs.save(handoff);
      await tx.runs.save(run);
      this.run = run;
      return true;
    });
    if (!ok) return 'lease_lost';
    await this.trackAttempt('completed', elapsed);
    await trackRunFinished(this.deps.analytics, this.run);
    return 'completed';
  }

  private async handle(error: unknown): Promise<AttemptResult> {
    if (error instanceof LeaseLostError) return 'lease_lost';
    if (error instanceof WorkerStopSignal) return 'stopped';
    let status: 'cancelled' | 'final_error' | 'retryable_error';
    let failure: { code: RunFailureCode; message: string } | null = null;
    if (error instanceof CancelRequestedSignal) status = 'cancelled';
    else if (error instanceof FinalRunError) {
      status = 'final_error';
      failure = { code: error.code, message: error.message };
    } else {
      status = 'retryable_error';
      failure =
        error instanceof RetryableRunError
          ? { code: error.code, message: error.message }
          : {
              code: 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : String(error),
            };
      this.deps.logger?.warn(
        { err: error, runId: this.run.id, attempt: this.attempt.n },
        'research attempt failed',
      );
    }
    if (failure) this.lastError = `${failure.code}: ${failure.message}`.slice(0, 1000);
    const now = this.deps.clock.now();
    const elapsed = this.elapsedSeconds();
    const conclusion = await this.deps.store.transaction(
      async (tx): Promise<AttemptConclusion | null> => {
        if (!(await tx.attempts.renewLease(this.run.id, this.attempt.n, this.deps.workerId, now)))
          return null;
        const run = await tx.runs.findForUpdate(this.run.id);
        if (!run || run.isFinished) return null;
        this.run = run;
        return concludeAttempt(tx, this.deps, {
          run,
          attempt: this.attempt,
          status,
          error: failure,
          activeSeconds: elapsed,
          handoff: this.handoff(now),
          now,
        });
      },
    );
    if (!conclusion) return 'lease_lost';
    if (conclusion.retry) {
      try {
        await this.deps.queue.enqueue(this.run.id, conclusion.retry);
      } catch (err) {
        // The sweeper queues due retries again.
        this.deps.logger?.warn({ err, runId: this.run.id }, 'could not queue the next attempt');
      }
    }
    await this.trackAttempt(status, elapsed);
    if (conclusion.finished) await trackRunFinished(this.deps.analytics, this.run);
    return status;
  }

  private async trackAttempt(outcome: string, activeSeconds: number): Promise<void> {
    const s = this.snapshot;
    await this.deps.analytics.track({
      name: 'run_attempt_finished',
      actor: { memberId: s.startedByMemberId, businessId: s.businessId },
      properties: {
        run_id: s.id,
        attempt: this.attempt.n,
        outcome,
        step_key: this.position.stepKey,
        active_s: Math.round(activeSeconds),
      },
    });
  }
}

/** Claude's output through the ToolRunner (`{ text, toolCall, usage, model }`) as an LlmResponse. */
function toLlmResponse(output: unknown): LlmResponse {
  const o = asRecord(output);
  const call = asRecord(o.toolCall);
  const usage = asRecord(o.usage);
  const name = asString(call.name);
  return {
    text: typeof o.text === 'string' ? o.text : '',
    ...(name ? { toolCall: { name, input: call.input } } : {}),
    usage: {
      inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
      outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
    },
    model: asString(o.model) ?? 'claude',
  };
}
