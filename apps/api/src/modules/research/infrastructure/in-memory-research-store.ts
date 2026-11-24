import type { FlowVersion } from '../domain/flow.js';
import { ACTIVE_STATUSES, ResearchRun, type RunSnapshot, type RunStatus } from '../domain/run.js';
import type {
  AttemptRecord,
  HandoffRecord,
  ResearchEvents,
  ResearchStore,
  ResearchTx,
  RunMessageRecord,
  RunPageCursor,
  StaffRunFilter,
  StepRecord,
} from '../application/ports.js';

interface State {
  flows: FlowVersion[];
  runs: Map<string, RunSnapshot>;
  steps: Map<string, StepRecord[]>;
  attempts: AttemptRecord[];
  handoffs: Map<string, HandoffRecord>;
  messages: RunMessageRecord[];
  emails: Set<string>;
  outbox: { type: keyof ResearchEvents; payload: unknown }[];
}

const empty = (): State => ({
  flows: [],
  runs: new Map(),
  steps: new Map(),
  attempts: [],
  handoffs: new Map(),
  messages: [],
  emails: new Set(),
  outbox: [],
});

const byNewest = (a: RunSnapshot, b: RunSnapshot) =>
  b.queuedAt.getTime() - a.queuedAt.getTime() || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);

function after(cursor: RunPageCursor | undefined) {
  return (r: RunSnapshot) =>
    !cursor ||
    r.queuedAt.getTime() < cursor.queuedAt.getTime() ||
    (r.queuedAt.getTime() === cursor.queuedAt.getTime() && r.id < cursor.id);
}

/**
 * research's storage in memory, for tests and other modules' tests. A transaction that throws
 * rolls every change back, like the database would. Stored values are cloned, so a change that
 * isn't saved is lost.
 */
export class InMemoryResearchStore implements ResearchStore {
  private state: State = empty();

  /** Events written to the outbox, in order. */
  get outbox(): readonly { type: keyof ResearchEvents; payload: unknown }[] {
    return this.state.outbox;
  }
  get messages(): readonly RunMessageRecord[] {
    return this.state.messages;
  }
  run(id: string): ResearchRun | null {
    const s = this.state.runs.get(id);
    return s ? ResearchRun.restore(structuredClone(s)) : null;
  }
  steps(runId: string): StepRecord[] {
    return structuredClone(this.state.steps.get(runId) ?? []);
  }
  attempts(runId: string): AttemptRecord[] {
    return structuredClone(this.state.attempts.filter((a) => a.runId === runId)).sort(
      (a, b) => a.n - b.n,
    );
  }
  handoff(runId: string): HandoffRecord | null {
    const h = this.state.handoffs.get(runId);
    return h ? structuredClone(h) : null;
  }

  private afterCommit: (() => Promise<void>)[] = [];

  /**
   * Runs `fn` once the current transaction commits (tests: something that happens between two
   * save points, like the sweeper taking an attempt over while the database holds no lock).
   */
  runAfterCommit(fn: () => Promise<void>): void {
    this.afterCommit.push(fn);
  }

  private open = 0;

  /** True while a transaction runs (tests: nothing slow may happen inside one). */
  get inTransaction(): boolean {
    return this.open > 0;
  }

  async transaction<T>(fn: (tx: ResearchTx) => Promise<T>): Promise<T> {
    const before = structuredClone(this.state);
    let result: T;
    this.open += 1;
    try {
      result = await fn(this.tx());
    } catch (error) {
      this.state = before;
      throw error;
    } finally {
      this.open -= 1;
    }
    for (const hook of this.afterCommit.splice(0)) await hook();
    return result;
  }

  private tx(): ResearchTx {
    const st = () => this.state;
    const restore = (s: RunSnapshot) => ResearchRun.restore(structuredClone(s));
    const runs = () => [...st().runs.values()];
    return {
      handle: { inMemory: true },
      flows: {
        latest: (key) => {
          const versions = st().flows.filter((f) => f.key === key);
          const latest = versions.sort((a, b) => b.version - a.version)[0];
          return Promise.resolve(latest ? structuredClone(latest) : null);
        },
        listLatest: () => {
          const keys = [...new Set(st().flows.map((f) => f.key))];
          const latest = keys
            .map(
              (k) =>
                st()
                  .flows.filter((f) => f.key === k)
                  .sort((a, b) => b.version - a.version)[0],
            )
            .filter((f): f is FlowVersion => f !== undefined)
            .sort(
              (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.key.localeCompare(b.key),
            );
          return Promise.resolve(structuredClone(latest));
        },
        insert: (flow) => {
          if (st().flows.some((f) => f.key === flow.key && f.version === flow.version)) {
            return Promise.reject(new Error(`Duplicate flow version ${flow.key} v${flow.version}`));
          }
          st().flows.push(structuredClone(flow));
          return Promise.resolve();
        },
        plansUsing: (keys) => {
          const counts = new Map<string, number>();
          for (const key of keys) {
            const plans = new Set(
              runs()
                .filter((r) => r.flow.key === key)
                .map((r) => r.planId),
            );
            counts.set(key, plans.size);
          }
          return Promise.resolve(counts);
        },
      },
      runs: {
        find: (id) => {
          const s = st().runs.get(id);
          return Promise.resolve(s ? restore(s) : null);
        },
        findByIds: (ids) =>
          Promise.resolve(
            [...new Set(ids)].flatMap((id) => {
              const s = st().runs.get(id);
              return s ? [restore(s)] : [];
            }),
          ),
        findForUpdate: (id) => {
          const s = st().runs.get(id);
          return Promise.resolve(s ? restore(s) : null);
        },
        insert: (run) => {
          st().runs.set(run.id, structuredClone(run.toSnapshot()));
          return Promise.resolve();
        },
        save: (run) => {
          st().runs.set(run.id, structuredClone(run.toSnapshot()));
          return Promise.resolve();
        },
        hasActive: (businessId) =>
          Promise.resolve(
            runs().some((r) => r.businessId === businessId && ACTIVE_STATUSES.includes(r.status)),
          ),
        listForPlan: (businessId, planId, page) =>
          Promise.resolve(
            runs()
              .filter((r) => r.businessId === businessId && r.planId === planId)
              .sort(byNewest)
              .filter(after(page.after))
              .slice(0, page.limit)
              .map(restore),
          ),
        listForStaff: (filter: StaffRunFilter, page) =>
          Promise.resolve(
            runs()
              .filter(
                (r) =>
                  (!filter.status || r.status === filter.status) &&
                  (!filter.businessId || r.businessId === filter.businessId),
              )
              .sort(byNewest)
              .filter(after(page.after))
              .slice(0, page.limit)
              .map(restore),
          ),
        latestForPlans: (businessId, planIds) => {
          const latest = new Map<string, RunSnapshot>();
          for (const r of runs()
            .filter((x) => x.businessId === businessId && planIds.includes(x.planId))
            .sort(byNewest)) {
            if (!latest.has(r.planId)) latest.set(r.planId, r);
          }
          return Promise.resolve([...latest.values()].map(restore));
        },
        recentForBusiness: (businessId, since, limit) =>
          Promise.resolve(
            runs()
              .filter((x) => x.businessId === businessId && (x.startedAt ?? x.queuedAt) >= since)
              .sort(
                (a, b) =>
                  (b.startedAt ?? b.queuedAt).getTime() - (a.startedAt ?? a.queuedAt).getTime() ||
                  (b.id < a.id ? -1 : b.id > a.id ? 1 : 0),
              )
              .slice(0, limit)
              .map(restore),
          ),
        recentCompletedCredits: (flowKey, limit) =>
          Promise.resolve(
            runs()
              .filter(
                (r) => r.flow.key === flowKey && r.status === 'completed' && r.leadsDelivered >= 1,
              )
              .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))
              .slice(0, limit)
              .map((r) => r.creditsSpent),
          ),
        dueRetries: (before, limit) =>
          Promise.resolve(
            runs()
              .filter(
                (r) =>
                  r.status === 'retrying' && r.nextAttemptAt !== null && r.nextAttemptAt <= before,
              )
              .slice(0, limit)
              .map(restore),
          ),
        staleQueued: (before, limit) =>
          Promise.resolve(
            runs()
              .filter((r) => r.status === 'queued' && r.queuedAt <= before)
              .slice(0, limit)
              .map(restore),
          ),
        countByStatus: (status: RunStatus) =>
          Promise.resolve(runs().filter((r) => r.status === status).length),
        factsQueuedIn: (window) =>
          Promise.resolve(
            runs()
              .filter((r) => r.queuedAt >= window.from && r.queuedAt < window.to)
              .map((r) => ({
                runId: r.id,
                businessId: r.businessId,
                status: r.status,
                queuedAt: r.queuedAt,
                startedAt: r.startedAt,
                finishedAt: r.finishedAt,
                creditsSpent: r.creditsSpent,
                maxCredits: r.plan.guardrails.maxCredits,
                providerCostMicros: r.providerCostMicros,
                leadsDelivered: r.leadsDelivered,
                icpEdited: r.plan.icpEdited,
                failureCode: r.failureCode,
              })),
          ),
        countByBusiness: (businessIds) => {
          const counts = new Map<string, number>();
          for (const r of runs()) {
            if (businessIds.includes(r.businessId)) {
              counts.set(r.businessId, (counts.get(r.businessId) ?? 0) + 1);
            }
          }
          return Promise.resolve(counts);
        },
      },
      steps: {
        list: (runId) =>
          Promise.resolve(
            structuredClone(st().steps.get(runId) ?? []).sort((a, b) => a.position - b.position),
          ),
        listForRuns: (runIds) =>
          Promise.resolve(
            new Map(
              runIds.map((id) => [
                id,
                structuredClone(st().steps.get(id) ?? []).sort((a, b) => a.position - b.position),
              ]),
            ),
          ),
        insertMany: (steps) => {
          for (const step of steps) {
            const list = st().steps.get(step.runId) ?? [];
            list.push(structuredClone(step));
            st().steps.set(step.runId, list);
          }
          return Promise.resolve();
        },
        save: (step) => {
          const list = st().steps.get(step.runId) ?? [];
          st().steps.set(step.runId, [
            ...list.filter((s) => s.key !== step.key),
            structuredClone(step),
          ]);
          return Promise.resolve();
        },
      },
      attempts: {
        insert: (attempt) => {
          if (st().attempts.some((a) => a.runId === attempt.runId && a.n === attempt.n)) {
            return Promise.reject(new Error('Duplicate attempt'));
          }
          st().attempts.push(structuredClone(attempt));
          return Promise.resolve();
        },
        save: (attempt) => {
          st().attempts = [
            ...st().attempts.filter((a) => !(a.runId === attempt.runId && a.n === attempt.n)),
            structuredClone(attempt),
          ];
          return Promise.resolve();
        },
        latest: (runId) => {
          const list = st()
            .attempts.filter((a) => a.runId === runId)
            .sort((a, b) => b.n - a.n);
          return Promise.resolve(list[0] ? structuredClone(list[0]) : null);
        },
        list: (runId) =>
          Promise.resolve(
            structuredClone(st().attempts.filter((a) => a.runId === runId)).sort(
              (a, b) => a.n - b.n,
            ),
          ),
        expiredLeases: (now, limit) =>
          Promise.resolve(
            structuredClone(
              st().attempts.filter(
                (a) =>
                  a.status === 'running' && a.leaseExpiresAt !== null && a.leaseExpiresAt < now,
              ),
            ).slice(0, limit),
          ),
        findForUpdate: (runId, n) => {
          const a = st().attempts.find((x) => x.runId === runId && x.n === n);
          return Promise.resolve(a ? structuredClone(a) : null);
        },
        renewLease: (runId, n, owner, until) => {
          const a = st().attempts.find((x) => x.runId === runId && x.n === n);
          if (a?.status !== 'running' || a.leaseOwner !== owner) return Promise.resolve(false);
          st().attempts = st().attempts.map((x) => (x === a ? { ...a, leaseExpiresAt: until } : x));
          return Promise.resolve(true);
        },
      },
      handoffs: {
        get: (runId) => {
          const h = st().handoffs.get(runId);
          return Promise.resolve(h ? structuredClone(h) : null);
        },
        save: (h) => {
          st().handoffs.set(h.runId, structuredClone(h));
          return Promise.resolve();
        },
      },
      messages: {
        append: (messages) => {
          st().messages.push(...structuredClone([...messages]));
          return Promise.resolve();
        },
      },
      emails: {
        claim: (eventId, recipient) => {
          const key = `${eventId}|${recipient}`;
          if (st().emails.has(key)) return Promise.resolve(false);
          st().emails.add(key);
          return Promise.resolve(true);
        },
        unclaim: (eventId, recipient) => {
          st().emails.delete(`${eventId}|${recipient}`);
          return Promise.resolve();
        },
      },
      outbox: {
        add: (type, payload) => {
          st().outbox.push({ type, payload: structuredClone(payload) });
          return Promise.resolve();
        },
      },
    };
  }
}
