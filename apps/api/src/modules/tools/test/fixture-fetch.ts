import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURES = new URL('../infrastructure/adapters/fixtures/', import.meta.url);

/** A recorded provider response (ADR 0005: adapters are tested against fixtures only). */
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, FIXTURES)), 'utf8')) as unknown;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A `fetch` that answers every request with one canned response and records the requests. */
export class FixtureFetch {
  readonly requests: RecordedRequest[] = [];
  private queue: (() => Response)[] = [];

  reply(status: number, body: unknown): this {
    this.queue.push(
      () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    return this;
  }

  networkError(): this {
    this.queue.push(() => {
      throw new TypeError('fetch failed');
    });
    return this;
  }

  readonly fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    this.requests.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    });
    const next = this.queue.shift();
    if (!next) return Promise.reject(new Error('FixtureFetch: no response queued'));
    try {
      return Promise.resolve(next());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  last(): RecordedRequest {
    const r = this.requests.at(-1);
    if (!r) throw new Error('no request');
    return r;
  }
}
