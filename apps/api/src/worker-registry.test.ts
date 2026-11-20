import { describe, expect, test } from 'vitest';
import { stopWorkers } from './worker-registry.js';

/** A worker whose graceful close finishes after `delayMs` (never, when null); force closes at once. */
function fakeWorker(log: string[], name: string, delayMs: number | null) {
  return {
    close(force?: boolean): Promise<void> {
      log.push(force ? `${name}:force` : `${name}:close`);
      if (force) return Promise.resolve();
      if (delayMs === null) return new Promise<void>(() => undefined);
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          log.push(`${name}:closed`);
          resolve();
        }, delayMs),
      );
    },
  };
}

const quietLogger = (warnings: string[]) => ({
  warn: (...args: unknown[]) => void warnings.push(String(args.at(-1))),
});

describe('worker shutdown', () => {
  test('closes the email sender only after every worker has closed', async () => {
    const log: string[] = [];
    await stopWorkers(
      {
        workers: [fakeWorker(log, 'a', 5), fakeWorker(log, 'b', 15)],
        close: () => log.push('email:close'),
      },
      { closeWaitMs: 1_000, logger: quietLogger([]) },
    );
    expect(log).toEqual(['a:close', 'b:close', 'a:closed', 'b:closed', 'email:close']);
  });

  test('a busy worker is force-closed at the wait limit, then the email sender closes', async () => {
    const log: string[] = [];
    const warnings: string[] = [];
    const started = Date.now();
    await stopWorkers(
      {
        workers: [fakeWorker(log, 'a', 1), fakeWorker(log, 'stuck', null)],
        close: () => log.push('email:close'),
      },
      { closeWaitMs: 30, logger: quietLogger(warnings) },
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(log).toEqual([
      'a:close',
      'stuck:close',
      'a:closed',
      'a:force',
      'stuck:force',
      'email:close',
    ]);
    expect(warnings).toEqual(['workers still busy at the shutdown deadline; closing them now']);
  });

  test('an email sender that throws on close does not stop the shutdown', async () => {
    const warnings: string[] = [];
    await expect(
      stopWorkers(
        {
          workers: [],
          close: () => {
            throw new Error('smtp gone');
          },
        },
        { closeWaitMs: 10, logger: quietLogger(warnings) },
      ),
    ).resolves.toBeUndefined();
    expect(warnings).toEqual(['could not close the email sender']);
  });
});
