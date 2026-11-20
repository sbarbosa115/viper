import { healthResponse } from '@app/contracts/health';
import { http, HttpResponse } from 'msw';
import { describe, expect, test } from 'vitest';
import { server } from '../../test/setup';
import { api, ApiError } from './client';

describe('shared: api client', () => {
  test('parses a successful response with the contract schema', async () => {
    server.use(
      http.get('*/api/health', () =>
        HttpResponse.json({ status: 'ok', checks: { database: 'ok' } }),
      ),
    );
    const res = await api('/health', { schema: healthResponse });
    expect(res.status).toBe('ok');
  });

  test('maps the error shape to ApiError', async () => {
    server.use(
      http.post('*/api/things', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid', fields: { name: 'Required' } } },
          { status: 400 },
        ),
      ),
    );
    const error = await api('/things', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: { name: 'Required' },
    });
  });
});
