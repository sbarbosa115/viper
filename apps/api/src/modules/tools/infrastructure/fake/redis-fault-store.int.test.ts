import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { FakeToolControls, RedisFaultStore } from './fake-tool-controls.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
});
const store = new RedisFaultStore(redis);

beforeEach(async () => {
  await store.clear();
});

afterAll(() => {
  redis.disconnect();
});

describe('AJ-5/AJ-9: fake error modes shared through Valkey', () => {
  test('a mode set by one process is seen by another and counts down', async () => {
    const api = new FakeToolControls(store);
    const worker = new FakeToolControls(new RedisFaultStore(redis));
    await api.failNext('google.places-text-search', 2);
    await expect(worker.before('google.places-text-search')).rejects.toMatchObject({
      retryable: true,
    });
    expect(await store.get('google.places-text-search')).toEqual({ mode: 'fail', remaining: 1 });
    await expect(worker.before('google.places-text-search')).rejects.toThrow();
    await expect(worker.before('google.places-text-search')).resolves.toBeUndefined();
  });

  test('reset clears every mode', async () => {
    await store.set('apify.google-maps', { mode: 'fail', remaining: null });
    await store.set('firecrawl.scrape', { mode: 'stall', ms: 10 });
    await store.clear();
    expect(await store.get('apify.google-maps')).toBeNull();
    expect(await store.get('firecrawl.scrape')).toBeNull();
  });
});
