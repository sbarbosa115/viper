import { errorResponse } from '@app/contracts/errors';
import { healthResponse } from '@app/contracts/health';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../test/build-test-app.js';

describe('shared kernel: GET /api/health', () => {
  test('is ok when every probe passes', async () => {
    const app = await buildTestApp({
      deps: { health: { database: () => Promise.resolve(), cache: () => Promise.resolve() } },
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(healthResponse.parse(res.json())).toEqual({
      status: 'ok',
      checks: { database: 'ok', cache: 'ok' },
    });
  });

  test('is 503 and names the failing dependency', async () => {
    const app = await buildTestApp({
      deps: {
        health: {
          database: () => Promise.resolve(),
          cache: () => Promise.reject(new Error('down')),
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(healthResponse.parse(res.json()).checks).toEqual({ database: 'ok', cache: 'down' });
  });

  test('unknown API routes use the error shape', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(errorResponse.parse(res.json()).error.code).toBe('NOT_FOUND');
  });
});

describe('site: GET /', () => {
  test('serves the placeholder page', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Llyner Leads');
  });
});
