import { errorResponse } from '@app/contracts/errors';
import { createProduct, getProfile, updateProfile } from '@app/contracts/profile';
import { describe, expect, test } from 'vitest';
import { buildTestApp } from '../../../../test/build-test-app.js';
import type { Actor } from '../../../shared/domain/actor.js';
import { austinInput, OTHER_BUSINESS, owner, profileFixture } from '../test/profile-fixture.js';

async function setup(actor?: Actor) {
  const f = profileFixture();
  const app = await buildTestApp({ modules: [f.module], ...(actor ? { actor } : {}) });
  return { ...f, app };
}

const errorCode = (body: unknown) => errorResponse.parse(body).error.code;

describe('FR-15: profile endpoints', () => {
  test('401 when not signed in', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/profile' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/profile/products', payload: { name: 'x' } }))
        .statusCode,
    ).toBe(401);
  });

  test('GET returns the Profile shape', async () => {
    const { app } = await setup(owner());
    const res = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(res.statusCode).toBe(200);
    expect(getProfile.response.parse(res.json()).complete).toBe(false);
  });

  test('PUT saves, geocodes and returns the Profile', async () => {
    const { app } = await setup(owner());
    const res = await app.inject({ method: 'PUT', url: '/api/profile', payload: austinInput });
    expect(res.statusCode).toBe(200);
    const body = updateProfile.response.parse(res.json());
    expect(body.location?.label).toBe('1200 E 6th St, Austin, TX 78702');
  });

  test('PUT validates the limits (400 with fields)', async () => {
    const { app } = await setup(owner());
    const res = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      payload: { ...austinInput, deliveryRadiusMiles: 101 },
    });
    expect(res.statusCode).toBe(400);
    expect(errorResponse.parse(res.json()).error.fields).toHaveProperty('deliveryRadiusMiles');
  });

  test('PUT with an unknown address → 422 ADDRESS_NOT_FOUND', async () => {
    const { app } = await setup(owner());
    const res = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      payload: {
        ...austinInput,
        address: { ...austinInput.address, line1: 'Nowhere', city: 'Atlantis' },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(errorCode(res.json())).toBe('ADDRESS_NOT_FOUND');
  });

  test('Products: create 201, update 200, delete 204, in use 409', async () => {
    const { app, usage } = await setup(owner());
    const created = await app.inject({
      method: 'POST',
      url: '/api/profile/products',
      payload: { name: 'Powdered sugar, 25 lb' },
    });
    expect(created.statusCode).toBe(201);
    const product = createProduct.response.parse(created.json());

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/profile/products/${product.id}`,
      payload: { name: 'Powdered sugar, 25 lb bag', description: 'Fine' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: 'Powdered sugar, 25 lb bag' });

    usage.inUse.add(product.id);
    const inUse = await app.inject({
      method: 'DELETE',
      url: `/api/profile/products/${product.id}`,
    });
    expect(inUse.statusCode).toBe(409);
    expect(errorCode(inUse.json())).toBe('PRODUCT_IN_USE');
    expect(errorResponse.parse(inUse.json()).error.message).toBe('Remove it from your plans first');

    usage.inUse.clear();
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/profile/products/${product.id}`,
    });
    expect(deleted.statusCode).toBe(204);
  });

  test('Products: empty name → 400; unknown id → 404; bad id → 400', async () => {
    const { app } = await setup(owner());
    expect(
      (await app.inject({ method: 'POST', url: '/api/profile/products', payload: { name: '' } }))
        .statusCode,
    ).toBe(400);
    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/profile/products/00000000-0000-7000-8000-0000000000ff',
    });
    expect(missing.statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/profile/products/not-a-uuid' })).statusCode,
    ).toBe(400);
  });

  test('cross-Business: B cannot change A’s Product', async () => {
    const f = profileFixture();
    const product = await f.service.createProduct(owner(), { name: 'Cane sugar' });
    const app = await buildTestApp({
      modules: [f.module],
      actor: owner({ businessId: OTHER_BUSINESS }),
    });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/profile/products/${product.id}`,
      payload: { name: 'Mine now' },
    });
    expect(res.statusCode).toBe(404);
    const profile = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(getProfile.response.parse(profile.json()).products).toEqual([]);
  });
});
