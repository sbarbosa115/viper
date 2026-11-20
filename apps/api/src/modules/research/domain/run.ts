import { DomainRuleViolation } from '../../../shared/domain/errors.js';
import type { FlowSettingsSnapshot } from './flow.js';

export type RunStatus = 'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'cancelled';

export type RunFailureCode =
  | 'PROVIDER_ERROR'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'TOOL_DISABLED'
  | 'TIME_LIMIT'
  | 'INSUFFICIENT_CREDITS'
  | 'INVALID_PLAN'
  | 'INTERNAL_ERROR';

/** The Plan as the run saw it when it started (planning's PlanForRun, plus Product names). */
export interface PlanSnapshot {
  readonly id: string;
  readonly businessId: string;
  readonly flowKey: string;
  readonly name: string;
  readonly goal: string;
  readonly segments: readonly {
    readonly id: string;
    readonly name: string;
    readonly fitSignals: readonly string[];
    readonly exclusions: readonly string[];
    readonly productId: string;
    readonly productName?: string | null;
  }[];
  readonly searchArea: {
    readonly label: string;
    readonly lat: number;
    readonly lng: number;
    readonly radiusMiles: number;
  };
  readonly guardrails: {
    readonly maxCredits: number;
    readonly maxLeads: number;
    readonly minFitScore: number;
  };
  readonly icpEdited: boolean;
}

/** Runner state that spans Steps and attempts (FR-20: a Tool failing 5 calls in a row is off). */
export interface RunnerState {
  readonly disabledTools: readonly string[];
  readonly failuresInARow: Readonly<Record<string, number>>;
  /**
   * Spend the failure policy waived (FR-20): a failed run with 0 Leads costs nothing, and that
   * stays so after "Try again" (founder's decision): only the spend after it can be charged.
   */
  readonly waivedMillicredits?: number;
}

export interface RunSnapshot {
  readonly id: string;
  readonly businessId: string;
  readonly planId: string;
  readonly flowId: string;
  readonly flow: FlowSettingsSnapshot;
  readonly plan: PlanSnapshot;
  readonly promptVersion: string;
  readonly status: RunStatus;
  readonly startedByMemberId: string;
  readonly startedByStaffId: string | null;
  readonly attempts: number;
  readonly attemptLimit: number;
  readonly activeSeconds: number;
  readonly activeOffsetSeconds: number;
  readonly nextAttemptAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly budgetReached: boolean;
  readonly timeReached: boolean;
  readonly failureCode: RunFailureCode | null;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly windowStartedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly creditsReserved: number;
  readonly creditsSpent: number;
  readonly millicreditsSpent: number;
  readonly providerCostMicros: number;
  readonly leadsDelivered: number;
  readonly state: RunnerState;
}

export const ACTIVE_STATUSES: readonly RunStatus[] = ['queued', 'running', 'retrying'];
export const FINISHED_STATUSES: readonly RunStatus[] = ['completed', 'failed', 'cancelled'];
const MAX_FAILURES_IN_A_ROW = 5;

/**
 * A Research run (FR-18 to FR-21, FR-36). One Reservation covers all its attempts; it settles
 * when the run ends. Changes only through these methods; the store keeps snapshots.
 */
export class ResearchRun {
  private constructor(private s: RunSnapshot) {}

  static queue(props: {
    id: string;
    flowId: string;
    flow: FlowSettingsSnapshot;
    plan: PlanSnapshot;
    promptVersion: string;
    startedByMemberId: string;
    startedByStaffId: string | null;
    now: Date;
  }): ResearchRun {
    return new ResearchRun({
      id: props.id,
      businessId: props.plan.businessId,
      planId: props.plan.id,
      flowId: props.flowId,
      flow: props.flow,
      plan: props.plan,
      promptVersion: props.promptVersion,
      status: 'queued',
      startedByMemberId: props.startedByMemberId,
      startedByStaffId: props.startedByStaffId,
      attempts: 0,
      attemptLimit: props.flow.runSettings.maxAttempts,
      activeSeconds: 0,
      activeOffsetSeconds: 0,
      nextAttemptAt: null,
      cancelRequestedAt: null,
      budgetReached: false,
      timeReached: false,
      failureCode: null,
      queuedAt: props.now,
      startedAt: null,
      windowStartedAt: null,
      finishedAt: null,
      creditsReserved: props.plan.guardrails.maxCredits,
      creditsSpent: 0,
      millicreditsSpent: 0,
      providerCostMicros: 0,
      leadsDelivered: 0,
      state: { disabledTools: [], failuresInARow: {} },
    });
  }

  static restore(s: RunSnapshot): ResearchRun {
    return new ResearchRun({ ...s });
  }

  get id(): string {
    return this.s.id;
  }
  get businessId(): string {
    return this.s.businessId;
  }
  get status(): RunStatus {
    return this.s.status;
  }
  get attempts(): number {
    return this.s.attempts;
  }
  get settings() {
    return this.s.flow.runSettings;
  }
  get isActive(): boolean {
    return ACTIVE_STATUSES.includes(this.s.status);
  }
  get isFinished(): boolean {
    return FINISHED_STATUSES.includes(this.s.status);
  }
  get cancelRequested(): boolean {
    return this.s.cancelRequestedAt !== null;
  }

  /** The hard budget in millicredits (FR-20: no Tool call may exceed the Reservation). */
  get budgetMillicredits(): number {
    return this.s.plan.guardrails.maxCredits * 1000;
  }
  get remainingMillicredits(): number {
    return Math.max(0, this.budgetMillicredits - this.s.millicreditsSpent);
  }

  /** Spend that can still be charged: all of it, less what a 0-Lead failure waived (FR-20). */
  get chargeableMillicredits(): number {
    return Math.max(0, this.s.millicreditsSpent - (this.s.state.waivedMillicredits ?? 0));
  }

  /** The failure policy waived everything spent so far (a failed run with 0 Leads, FR-20). */
  waiveSpend(): void {
    this.s = {
      ...this.s,
      state: { ...this.s.state, waivedMillicredits: this.s.millicreditsSpent },
    };
  }

  /** Active seconds that count against the current limits window (a resume starts a new one). */
  windowActiveSeconds(extra = 0): number {
    return this.s.activeSeconds - this.s.activeOffsetSeconds + extra;
  }

  /** Starts attempt n+1. Only a queued or retrying run can. */
  beginAttempt(now: Date): number {
    if (this.s.status !== 'queued' && this.s.status !== 'retrying') {
      throw new DomainRuleViolation('Only a queued or retrying run can start an attempt');
    }
    this.s = {
      ...this.s,
      status: 'running',
      attempts: this.s.attempts + 1,
      nextAttemptAt: null,
      startedAt: this.s.startedAt ?? now,
      windowStartedAt: this.s.windowStartedAt ?? now,
      // A new attempt gives every Tool a fresh chance (a provider may be back, FR-19).
      state: { ...this.s.state, disabledTools: [], failuresInARow: {} },
    };
    return this.s.attempts;
  }

  /** Takes a cancel request saved by the api while this attempt was running (FR-21). */
  adoptCancelRequest(stored: ResearchRun): void {
    const at = stored.s.cancelRequestedAt;
    if (at && !this.s.cancelRequestedAt) this.s = { ...this.s, cancelRequestedAt: at };
  }

  /** Adds an ended attempt's active time (FR-36: active time counts only while an attempt runs). */
  addActiveSeconds(seconds: number): void {
    this.s = { ...this.s, activeSeconds: this.s.activeSeconds + Math.max(0, Math.round(seconds)) };
  }

  addSpend(millicredits: number, providerCostMicros: number): void {
    this.s = {
      ...this.s,
      millicreditsSpent: this.s.millicreditsSpent + millicredits,
      providerCostMicros: this.s.providerCostMicros + providerCostMicros,
    };
  }

  markBudgetReached(): void {
    this.s = { ...this.s, budgetReached: true };
  }
  markTimeReached(): void {
    this.s = { ...this.s, timeReached: true };
  }

  setLeadsDelivered(n: number): void {
    this.s = { ...this.s, leadsDelivered: n };
  }

  /** Counts a failed Tool call; the fifth in a row disables the Tool for this run (FR-20). */
  recordToolFailure(toolKey: string): { disabled: boolean } {
    const n = (this.s.state.failuresInARow[toolKey] ?? 0) + 1;
    const disabled = n >= MAX_FAILURES_IN_A_ROW;
    this.s = {
      ...this.s,
      state: {
        failuresInARow: { ...this.s.state.failuresInARow, [toolKey]: n },
        disabledTools: disabled
          ? [...new Set([...this.s.state.disabledTools, toolKey])]
          : this.s.state.disabledTools,
      },
    };
    return { disabled };
  }

  recordToolSuccess(toolKey: string): void {
    if (!this.s.state.failuresInARow[toolKey]) return;
    this.s = {
      ...this.s,
      state: { ...this.s.state, failuresInARow: { ...this.s.state.failuresInARow, [toolKey]: 0 } },
    };
  }

  disableTool(toolKey: string): void {
    this.s = {
      ...this.s,
      state: {
        ...this.s.state,
        disabledTools: [...new Set([...this.s.state.disabledTools, toolKey])],
      },
    };
  }

  isToolDisabled(toolKey: string): boolean {
    return this.s.state.disabledTools.includes(toolKey);
  }

  /** True when another automatic attempt is allowed (attempts and total time left). */
  canRetry(now: Date): boolean {
    if (this.s.attempts >= this.s.attemptLimit) return false;
    return !this.totalTimeUsed(now);
  }

  totalTimeUsed(now: Date): boolean {
    const from = this.s.windowStartedAt;
    if (!from) return false;
    return now.getTime() - from.getTime() >= this.settings.maxTotalHours * 3_600_000;
  }

  /** The attempt ended with a retryable error: the next one starts at `at` (FR-36). */
  scheduleRetry(at: Date): void {
    this.assertActive();
    this.s = { ...this.s, status: 'retrying', nextAttemptAt: at };
  }

  /** Cancel (FR-21): a queued or retrying run stops now, a running one after its Tool call. */
  requestCancel(now: Date): { immediate: boolean } {
    if (!this.isActive) throw new DomainRuleViolation('Only an active run can be cancelled');
    this.s = { ...this.s, cancelRequestedAt: this.s.cancelRequestedAt ?? now };
    return { immediate: this.s.status !== 'running' };
  }

  complete(now: Date, creditsSpent: number): void {
    this.finish('completed', now, creditsSpent, null);
  }

  fail(code: RunFailureCode, now: Date, creditsSpent: number): void {
    this.finish('failed', now, creditsSpent, code);
  }

  cancel(now: Date, creditsSpent: number): void {
    this.finish('cancelled', now, creditsSpent, null);
  }

  /**
   * Owner "Try again" / Staff "Resume" (FR-21, FR-32, FR-36): a failed run gets one more attempt
   * beyond the automatic ones, with fresh time limits, continuing from its stored progress.
   */
  resume(now: Date): void {
    if (this.s.status !== 'failed') throw new DomainRuleViolation('Only a failed run can resume');
    this.s = {
      ...this.s,
      status: 'queued',
      attemptLimit: this.s.attempts + 1,
      activeOffsetSeconds: this.s.activeSeconds,
      windowStartedAt: now,
      failureCode: null,
      finishedAt: null,
      cancelRequestedAt: null,
      nextAttemptAt: null,
      state: { ...this.s.state, failuresInARow: {} },
    };
  }

  /** What the resumed run must hold: the budget not charged yet (FR-32 "remaining budget"). */
  get resumeHoldCredits(): number {
    return Math.max(1, this.s.plan.guardrails.maxCredits - this.s.creditsSpent);
  }

  toSnapshot(): RunSnapshot {
    return { ...this.s };
  }

  private finish(
    status: 'completed' | 'failed' | 'cancelled',
    now: Date,
    creditsSpent: number,
    code: RunFailureCode | null,
  ): void {
    if (this.isFinished) throw new DomainRuleViolation('The run has already finished');
    this.s = {
      ...this.s,
      status,
      finishedAt: now,
      creditsSpent,
      failureCode: code,
      nextAttemptAt: null,
    };
  }

  private assertActive(): void {
    if (!this.isActive) throw new DomainRuleViolation('The run is not active');
  }
}
