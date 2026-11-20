import { errorResponse } from '@app/contracts/errors';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { buildTestApp } from '../../../test/build-test-app.js';
import type { AppModule } from '../../app.js';
import { CodedError, ConflictError, ForbiddenError } from '../domain/errors.js';

const probeModule: AppModule = {
  name: 'probe',
  register(app) {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    typed.post('/probe', { schema: { body: z.object({ email: z.email() }) } }, () => ({
      ok: true,
    }));
    app.get('/conflict', () => {
      throw new ConflictError('Already there');
    });
    app.get('/secret', { preHandler: app.authenticate }, () => {
      throw new ForbiddenError('Nope');
    });
    app.get('/step-time', () => {
      throw new CodedError('STEP_TIME_OVER_ACTIVE_TIME', 'Too long', { totalMinutes: 61 });
    });
    app.get('/boom', () => {
      throw new Error('internal detail');
    });
  },
};

describe('shared kernel: central error handler', () => {
  test('invalid body gives 400 with field messages', async () => {
    const app = await buildTestApp({ modules: [probeModule] });
    const res = await app.inject({ method: 'POST', url: '/api/probe', payload: { email: 'x' } });
    expect(res.statusCode).toBe(400);
    const parsed = errorResponse.parse(res.json());
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
    expect(parsed.error.fields).toHaveProperty('email');
  });

  test('typed errors map to their status', async () => {
    const app = await buildTestApp({ modules: [probeModule] });
    const res = await app.inject({ method: 'GET', url: '/api/conflict' });
    expect(res.statusCode).toBe(409);
    expect(errorResponse.parse(res.json()).error.code).toBe('CONFLICT');
  });

  test('STEP_TIME_OVER_ACTIVE_TIME maps to 422 with its details', async () => {
    const app = await buildTestApp({ modules: [probeModule] });
    const res = await app.inject({ method: 'GET', url: '/api/step-time' });
    expect(res.statusCode).toBe(422);
    expect(errorResponse.parse(res.json()).error).toEqual({
      code: 'STEP_TIME_OVER_ACTIVE_TIME',
      message: 'Too long',
      details: { totalMinutes: 61 },
    });
  });

  test('authenticate gives 401 without an actor', async () => {
    const app = await buildTestApp({ modules: [probeModule] });
    const res = await app.inject({ method: 'GET', url: '/api/secret' });
    expect(res.statusCode).toBe(401);
  });

  test('authenticate lets the stub actor through', async () => {
    const app = await buildTestApp({
      modules: [probeModule],
      actor: { memberId: 'm', businessId: 'b', roles: ['owner'], emailVerified: true },
    });
    const res = await app.inject({ method: 'GET', url: '/api/secret' });
    expect(res.statusCode).toBe(403);
  });

  test('unexpected errors are hidden behind a generic 500', async () => {
    const app = await buildTestApp({ modules: [probeModule] });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('internal detail');
  });
});
