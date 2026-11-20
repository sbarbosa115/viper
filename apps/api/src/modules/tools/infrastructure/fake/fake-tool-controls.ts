import { ToolFailure } from '../../application/tool-adapter.js';
import type { Sleeper } from '../../application/ports.js';

/** An error mode set on a fake Tool (tests and e2e, AJ-5/AJ-9). */
export type Fault =
  | { readonly mode: 'fail'; readonly remaining: number | null }
  | { readonly mode: 'stall'; readonly ms: number };

/** Where error modes live: memory in unit tests, Valkey so the api's test route reaches the worker. */
export interface FaultStore {
  get(toolKey: string): Promise<Fault | null>;
  set(toolKey: string, fault: Fault | null): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryFaultStore implements FaultStore {
  private readonly faults = new Map<string, Fault>();
  get(toolKey: string): Promise<Fault | null> {
    return Promise.resolve(this.faults.get(toolKey) ?? null);
  }
  set(toolKey: string, fault: Fault | null): Promise<void> {
    if (fault) this.faults.set(toolKey, fault);
    else this.faults.delete(toolKey);
    return Promise.resolve();
  }
  clear(): Promise<void> {
    this.faults.clear();
    return Promise.resolve();
  }
}

/** The ioredis calls the Valkey store uses. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

const PREFIX = 'tools:fake-fault:';

export class RedisFaultStore implements FaultStore {
  constructor(private readonly redis: RedisLike) {}

  async get(toolKey: string): Promise<Fault | null> {
    const raw = await this.redis.get(PREFIX + toolKey);
    return raw ? (JSON.parse(raw) as Fault) : null;
  }
  async set(toolKey: string, fault: Fault | null): Promise<void> {
    if (fault) await this.redis.set(PREFIX + toolKey, JSON.stringify(fault));
    else await this.redis.del(PREFIX + toolKey);
  }
  async clear(): Promise<void> {
    const keys = await this.redis.keys(`${PREFIX}*`);
    if (keys.length > 0) await this.redis.del(...keys);
  }
}

/**
 * Switchable error modes for the fake Tools: `failNext(key, n)` fails the next n calls,
 * `failAlways(key)` fails every call, `stall(key, ms)` delays each call. Failures are retryable
 * provider errors (HTTP 503), as a provider outage would be.
 */
export class FakeToolControls {
  constructor(
    private readonly store: FaultStore = new InMemoryFaultStore(),
    private readonly sleeper: Sleeper = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  ) {}

  failNext(toolKey: string, n = 1): Promise<void> {
    return this.store.set(toolKey, { mode: 'fail', remaining: Math.max(1, Math.floor(n)) });
  }
  failAlways(toolKey: string): Promise<void> {
    return this.store.set(toolKey, { mode: 'fail', remaining: null });
  }
  stall(toolKey: string, ms = 30_000): Promise<void> {
    return this.store.set(toolKey, { mode: 'stall', ms });
  }
  heal(toolKey: string): Promise<void> {
    return this.store.set(toolKey, null);
  }
  reset(): Promise<void> {
    return this.store.clear();
  }

  /** Called by every fake adapter before it answers. */
  async before(toolKey: string): Promise<void> {
    const fault = await this.store.get(toolKey);
    if (!fault) return;
    if (fault.mode === 'stall') {
      await this.sleeper.sleep(fault.ms);
      return;
    }
    if (fault.remaining !== null) {
      await this.store.set(
        toolKey,
        fault.remaining > 1 ? { mode: 'fail', remaining: fault.remaining - 1 } : null,
      );
    }
    throw ToolFailure.retryable(`Fake ${toolKey} answered HTTP 503: provider unavailable`);
  }
}
