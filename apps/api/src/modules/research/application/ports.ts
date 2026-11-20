import type { Ceilings } from '@app/contracts/platform';
import type { FlowVersion } from '../domain/flow.js';
import type { ResearchRun, RunStatus } from '../domain/run.js';

// ------------------------------------------------------------------------------------------------
// research's own storage
// ------------------------------------------------------------------------------------------------

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';
export type AttemptStatus =
  'running' | 'completed' | 'retryable_error' | 'final_error' | 'worker_stopped' | 'cancelled';

/** Step progress, saved after every Tool call (FR-19 "Every step is stored"). */
export interface StepProgress {
  /** Work item ids done (search terms, Prospect ids, contacts…). */
  readonly done: readonly string[];
  /** Work items the Step planned (for "items left"). */
  readonly total: number;
  /** Provider Tool calls that succeeded / failed in this Step, over all attempts. */
  readonly okCalls: number;
  readonly failedCalls: number;
  /** Active seconds spent in this Step over all attempts (its time limit, FR-20). */
  readonly activeSeconds: number;
  /** Why the Step stopped early, if it did (`budget_share`, `time_limit`, `collection_stopped`…). */
  readonly stoppedBy?: string | null;
  /** Step-specific counters (e.g. `prospectsFound`). */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface StepRecord {
  readonly id: string;
  readonly runId: string;
  readonly key: string;
  readonly position: number;
  readonly status: StepStatus;
  readonly attempts: number;
  readonly progress: StepProgress | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly millicreditsSpent: number;
  /** Step outputs after the Step (e.g. search terms, kept Prospect ids). */
  readonly checkpoint: Readonly<Record<string, unknown>> | null;
  readonly error: string | null;
}

/** What one attempt leaves for the next (FR-36, ADR 0017). */
export interface HandoffValues {
  readonly stepKey: string;
  readonly itemsDone: number;
  readonly itemsLeft: number;
  /** The agent's working notes, at most 2,000 characters. */
  readonly notes: string;
  readonly lastError: string | null;
  readonly creditsLeft: number;
  readonly activeSecondsLeft: number;
}

export interface HandoffRecord extends HandoffValues {
  readonly runId: string;
  readonly attemptN: number;
  readonly updatedAt: Date;
}

export interface AttemptRecord {
  readonly id: string;
  readonly runId: string;
  readonly n: number;
  readonly status: AttemptStatus;
  readonly fromStep: string;
  readonly fromItem: number;
  readonly reachedStep: string | null;
  readonly reachedItem: number | null;
  readonly error: string | null;
  readonly handoff: HandoffValues | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly activeSeconds: number;
}

/** One agent message, kept 90 days for Staff and never fed back to the agent (FR-36). */
export interface RunMessageRecord {
  readonly id: string;
  readonly runId: string;
  readonly attemptN: number;
  readonly stepKey: string;
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: unknown;
  readonly createdAt: Date;
}

export interface RunPageCursor {
  readonly queuedAt: Date;
  readonly id: string;
}

export interface FlowRepository {
  /** The latest version of a flow. */
  latest(key: string): Promise<FlowVersion | null>;
  /** The latest version of every flow, default first. */
  listLatest(): Promise<FlowVersion[]>;
  insert(flow: FlowVersion): Promise<void>;
  /** How many Plans have run each flow (FR-37 "plans using"). */
  plansUsing(keys: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

export interface StaffRunFilter {
  readonly status?: RunStatus;
  readonly businessId?: string;
}

export interface RunRepository {
  find(id: string): Promise<ResearchRun | null>;
  /** Locks the run row for the rest of the transaction. */
  findForUpdate(id: string): Promise<ResearchRun | null>;
  insert(run: ResearchRun): Promise<void>;
  save(run: ResearchRun): Promise<void>;
  /** A queued, running or retrying run exists for the Business (FR-18 RUN_IN_PROGRESS). */
  hasActive(businessId: string): Promise<boolean>;
  /** Newest first, strictly after `after`. */
  listForPlan(
    businessId: string,
    planId: string,
    page: { after?: RunPageCursor; limit: number },
  ): Promise<ResearchRun[]>;
  listForStaff(
    filter: StaffRunFilter,
    page: { after?: RunPageCursor; limit: number },
  ): Promise<ResearchRun[]>;
  /** The newest run of each Plan (planning's PlanActivity.lastRuns). */
  latestForPlans(businessId: string, planIds: readonly string[]): Promise<ResearchRun[]>;
  /** Credits spent by the last 20 completed runs of the flow with ≥ 1 Lead, newest first. */
  recentCompletedCredits(flowKey: string, limit: number): Promise<number[]>;
  /** Retrying runs whose next attempt is due before `before` (the sweeper re-queues them). */
  dueRetries(before: Date, limit: number): Promise<ResearchRun[]>;
  /** Queued runs waiting since before `before` (lost queue jobs). */
  staleQueued(before: Date, limit: number): Promise<ResearchRun[]>;
  countByStatus(status: RunStatus): Promise<number>;
  /** Staff reporting (FR-30): every run queued in [from, to), all Businesses. */
  factsQueuedIn(window: ReportWindow): Promise<RunFact[]>;
  /** Staff reporting (FR-31): runs ever started per Business; Businesses without runs are left out. */
  countByBusiness(businessIds: readonly string[]): Promise<Map<string, number>>;
}

/** A half-open time window [from, to). */
export interface ReportWindow {
  readonly from: Date;
  readonly to: Date;
}

/** One run as Staff reporting reads it (the Plan's budget and ICP flag as the run saw them). */
export interface RunFact {
  readonly runId: string;
  readonly businessId: string;
  readonly status: RunStatus;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly creditsSpent: number;
  readonly maxCredits: number;
  readonly providerCostMicros: number;
  readonly leadsDelivered: number;
  readonly icpEdited: boolean;
  readonly failureCode: string | null;
}

export interface StepRepository {
  list(runId: string): Promise<StepRecord[]>;
  /** Steps of many runs at once (run summaries without N+1 queries). */
  listForRuns(runIds: readonly string[]): Promise<ReadonlyMap<string, StepRecord[]>>;
  insertMany(steps: readonly StepRecord[]): Promise<void>;
  save(step: StepRecord): Promise<void>;
}

export interface AttemptRepository {
  insert(attempt: AttemptRecord): Promise<void>;
  save(attempt: AttemptRecord): Promise<void>;
  /** The attempt with the highest n. */
  latest(runId: string): Promise<AttemptRecord | null>;
  list(runId: string): Promise<AttemptRecord[]>;
  /** Running attempts whose lease expired before `now` (the sweeper ends them). */
  expiredLeases(now: Date, limit: number): Promise<AttemptRecord[]>;
  /**
   * Extends the lease of a running attempt held by `owner`. False when the attempt is no longer
   * running or no longer ours (the sweeper ended it): the worker must stop writing.
   */
  renewLease(runId: string, n: number, owner: string, until: Date): Promise<boolean>;
}

export interface HandoffRepository {
  get(runId: string): Promise<HandoffRecord | null>;
  save(handoff: HandoffRecord): Promise<void>;
}

export interface MessageRepository {
  append(messages: readonly RunMessageRecord[]): Promise<void>;
}

/** Run email claims: one email per (outbox event, recipient) (FR-22). */
export interface RunEmailLog {
  /** True when this call claimed the email (no one sent it yet). */
  claim(eventId: string, recipient: 'owner' | 'support', runId: string, at: Date): Promise<boolean>;
  unclaim(eventId: string, recipient: 'owner' | 'support'): Promise<void>;
}

export interface RunEnded {
  readonly runId: string;
  readonly businessId: string;
  readonly planId: string;
  /** Set when Staff started the run while Acting as: no customer email (FR-22). */
  readonly startedByStaffId: string | null;
}

/** The outbox events research writes (shared/infrastructure/outbox/events.ts). */
export interface ResearchEvents {
  RunRequested: { readonly runId: string; readonly businessId: string };
  RunCompleted: RunEnded;
  RunFailed: RunEnded & { readonly failureCode: string };
  RunCancelled: RunEnded;
}

export interface TxOutbox {
  add<K extends keyof ResearchEvents>(type: K, payload: ResearchEvents[K]): Promise<void>;
}

/** Everything research stores, inside one transaction. */
export interface ResearchTx {
  /** The open transaction, passed as `within` to billing, tools and leads. */
  readonly handle: object;
  readonly flows: FlowRepository;
  readonly runs: RunRepository;
  readonly steps: StepRepository;
  readonly attempts: AttemptRepository;
  readonly handoffs: HandoffRepository;
  readonly messages: MessageRepository;
  readonly emails: RunEmailLog;
  readonly outbox: TxOutbox;
}

export interface ResearchStore {
  transaction<T>(fn: (tx: ResearchTx) => Promise<T>): Promise<T>;
}

// ------------------------------------------------------------------------------------------------
// Other contexts, as research needs them (wired in composition.ts)
// ------------------------------------------------------------------------------------------------

export interface SourceRef {
  readonly name: string;
  readonly url: string | null;
  readonly retrievedAt: string;
}

export interface ToolCallError {
  /**
   * `PROVIDER_ERROR`, `TOOL_DISABLED`, `PROVIDER_NOT_CONFIGURED`, `BUDGET_EXCEEDED` (the call's
   * max cost exceeds the run's budget), `INVALID_INPUT`, `INVALID_OUTPUT`.
   */
  readonly code: string;
  readonly message: string;
  /** True when a later try may succeed (provider down, rate limited, timeout). */
  readonly retryable?: boolean;
}

export interface ToolCallRequest {
  readonly businessId: string;
  readonly runId: string;
  readonly stepKey: string;
  readonly attemptN: number;
  readonly toolKey: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** The run's hard budget left; a call whose max cost exceeds it is `skipped`. */
  readonly budget: { readonly remainingMillicredits: number };
  /** research's open transaction: the Tool call record commits with the handoff (FR-36). */
  readonly within?: object;
}

export interface ToolCallResult {
  readonly status: 'ok' | 'error' | 'skipped';
  readonly output: unknown;
  readonly units: number;
  readonly millicredits: number;
  readonly providerCostMicros?: number;
  /** Answered from a stored call with the same Tool and input hash: not called, 0 credits. */
  readonly reused: boolean;
  readonly error: ToolCallError | null;
}

/**
 * The tools module's metered ToolRunner (FR-23). Reuse by input hash happens inside it, and so
 * does the FR-20 provider retry (1 s, 4 s, 16 s) unless research's executor is told to retry.
 * Claude is called through it too (`claude.fast`, `claude.planning`: input `{ system, messages,
 * tools, maxTokens, purpose, timeoutMs }`, output `{ text, toolCall, usage, model }`).
 */
export interface ToolRunnerPort {
  call(request: ToolCallRequest): Promise<ToolCallResult>;
}

/** Which Tools can be called now (enabled and configured), FR-18 RESEARCH_UNAVAILABLE. */
export interface ToolCatalogPort {
  availability(toolKeys: readonly string[]): Promise<ReadonlyMap<string, boolean>>;
}

export interface ToolCallView {
  readonly id: string;
  readonly stepKey: string | null;
  readonly toolKey: string;
  readonly units: number;
  readonly millicredits: number;
  readonly providerCostMicros: number;
  readonly status: 'ok' | 'error' | 'skipped';
  readonly error: string | null;
  readonly durationMs: number;
  readonly createdAt: Date;
  readonly attemptN: number | null;
  readonly reused: boolean;
}

/** The tools module's Tool calls of a run, for the Staff run detail (FR-32). */
export interface ToolCallLogPort {
  listForRun(runId: string): Promise<ToolCallView[]>;
}

export type ContactType =
  'phone' | 'email' | 'website' | 'instagram' | 'tiktok' | 'yelp' | 'facebook';
export type Verification = 'verified' | 'unverified' | 'invalid';

export interface ProspectContact {
  readonly type: ContactType;
  readonly value: string;
  readonly label?: string | null;
  readonly verification: Verification;
  readonly source: SourceRef;
}

export interface ProspectEvidence {
  readonly fact: string;
  readonly points: number;
  readonly source: SourceRef;
}

/** A business found by a places Tool (FR-19 Step 2). */
export interface ProspectInput {
  /** e.g. `google:ChIJ…`, `osm:node/123`. */
  readonly placeKeys: readonly string[];
  readonly name: string;
  readonly address: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly category: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly rating: number | null;
  readonly reviewsCount: number | null;
  readonly segmentId: string | null;
  readonly source: SourceRef;
}

export interface Prospect {
  readonly id: string;
  readonly runId: string;
  readonly name: string;
  readonly address: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly category: string | null;
  readonly website: string | null;
  readonly domain: string | null;
  readonly rating: number | null;
  readonly reviewsCount: number | null;
  readonly placeKeys: readonly string[];
  readonly segmentId: string | null;
  readonly preScore: number | null;
  /** Why a Prospect was dropped (e.g. `already_delivered`), else null. */
  readonly excluded: string | null;
  readonly contacts: readonly ProspectContact[];
  readonly evidence: readonly ProspectEvidence[];
  readonly sources: readonly SourceRef[];
  readonly fitScore: number | null;
  readonly pitch: {
    readonly productId: string;
    readonly productName: string | null;
    readonly reason: string;
  } | null;
  readonly summary: string | null;
}

/** Changes to a Prospect; contacts and evidence are merged (deduplicated) by the leads module. */
export interface ProspectPatch {
  readonly preScore?: number;
  readonly excluded?: string | null;
  readonly addContacts?: readonly ProspectContact[];
  /**
   * Results of verification checks (Step 8) for existing contacts (type + value); leads records
   * them and fires `lead_contact_verified` (FR-25).
   */
  readonly verifyContacts?: readonly {
    readonly type: ContactType;
    readonly value: string;
    readonly verification: Verification;
    readonly source: SourceRef;
  }[];
  readonly addEvidence?: readonly ProspectEvidence[];
  readonly addSources?: readonly SourceRef[];
  readonly fitScore?: number;
  readonly pitch?: {
    readonly productId: string;
    readonly productName: string | null;
    readonly reason: string;
  };
  readonly summary?: string;
  readonly ownerNames?: readonly string[];
}

/**
 * The leads module's Prospect storage (FR-19, FR-25). Writes accept research's transaction as
 * `within`, so Prospects commit with the step progress that found them.
 */
export interface ProspectStorePort {
  /** Adds Prospects, merging duplicates (place id, phone, domain, name + 50 m) inside leads. */
  addProspects(
    runId: string,
    businessId: string,
    prospects: readonly ProspectInput[],
    within?: object,
  ): Promise<{ added: number; total: number }>;
  listProspects(runId: string, filter?: { stage?: string }): Promise<Prospect[]>;
  updateProspect(prospectId: string, patch: ProspectPatch, within?: object): Promise<void>;
  /** FR-25 qualification and delivery; idempotent per run (returns the run's delivered count). */
  deliver(
    request: {
      runId: string;
      businessId: string;
      planId: string;
      minFitScore: number;
      maxLeads: number;
    },
    within?: object,
  ): Promise<{ delivered: number }>;
  /** Place keys of Leads already delivered for the Plan (FR-19 Step 3, FR-25). */
  alreadyDeliveredPlaceKeys(planId: string): Promise<ReadonlySet<string>>;
}

/** billing's Reservation commands (ADR 0009), each accepting research's transaction. */
export interface BillingPort {
  reserve(
    cmd: { businessId: string; runId: string; credits: number },
    within?: object,
  ): Promise<unknown>;
  topUpReservation(cmd: { runId: string; credits: number }, within?: object): Promise<unknown>;
  settle(
    cmd: { runId: string; creditsSpent: number; planName?: string },
    within?: object,
  ): Promise<{ charged: number; released: number }>;
}

/** planning's `getPlanSnapshot` (PlanForRun). */
export interface PlanSnapshotsPort {
  getPlanSnapshot(
    businessId: string,
    planId: string,
  ): Promise<{
    id: string;
    businessId: string;
    flowKey: string;
    name: string;
    goal: string;
    segments: {
      id: string;
      name: string;
      fitSignals: string[];
      exclusions: string[];
      productId: string;
    }[];
    searchArea: { label: string; lat: number; lng: number; radiusMiles: number };
    guardrails: { maxCredits: number; maxLeads: number; minFitScore: number };
    icpEdited: boolean;
  } | null>;
}

/** profile's Product names, so Pitches and prompts can name the Product (optional). */
export interface ProductNamesPort {
  names(businessId: string): Promise<ReadonlyMap<string, string>>;
}

/** identity's queries research needs. */
export interface IdentityPort {
  getOwnerContact(businessId: string): Promise<{ email: string; name: string } | null>;
  getBusinesses(ids: readonly string[]): Promise<{ id: string; name: string }[]>;
}

/** platform's settings research reads. */
export interface PlatformSettingsPort {
  ceilings(): Promise<Ceilings>;
  support(): Promise<{ supportEmail: string | null }>;
}

/** platform's Audit log (FR-7). */
export interface AuditPort {
  record(entry: {
    staffMemberId: string;
    businessId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    details?: Record<string, unknown>;
  }): Promise<void>;
}

/** The research-runs queue (BullMQ in the worker). Jobs are de-duplicated by run and attempt. */
export interface RunQueue {
  enqueue(runId: string, options: { attemptN: number; delayMs: number }): Promise<void>;
}

export interface QueueCounts {
  readonly waiting: number;
  readonly active: number;
  readonly failed: number;
  readonly delayed: number;
}

/** Queue health for Staff (FR-32). */
export interface QueueMonitor {
  counts(): Promise<QueueCounts>;
  sweeperStatus(): Promise<{ lastRunAt: Date | null; stalledFound: number }>;
  recordSweep(at: Date, stalledFound: number): Promise<void>;
  workerLastSeenAt(): Promise<Date | null>;
}

export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

/**
 * Test-only (ENABLE_TEST_HOOKS, AJ-9): makes the worker "stop" in a Step after N work items, as
 * if it crashed. Consumed once.
 */
export interface StopHook {
  take(): Promise<{ stepKey: string; items: number } | null>;
  set(hook: { stepKey: string; items: number }): Promise<void>;
}

/** Runs `beat` every `everyMs` until stopped (the attempt's lease renewal, every 30 s). */
export interface Heartbeat {
  start(beat: () => Promise<void>, everyMs: number): () => void;
}
