import { errorResponse } from '@app/contracts/errors';
import { ids, profile as profileExample, product as productExample } from '@app/contracts/examples';
import {
  product as productSchema,
  productInput,
  profile as profileSchema,
  profileInput,
  type Profile,
} from '@app/contracts/profile';
import { http, HttpResponse } from 'msw';
import type { z } from 'zod';

/** Tweak per test; `resetProfileState()` restores the defaults. */
export const profileState: {
  profile: Profile;
  /** Set to make the next PUT /api/profile fail with this response. */
  saveError: { status: number; code: string; fields?: Record<string, string> } | null;
  /** Product ids that a Plan segment still pitches (DELETE answers 409). */
  inUse: Set<string>;
  saved: unknown[];
} = { profile: profileExample, saveError: null, inUse: new Set(), saved: [] };

export function resetProfileState() {
  profileState.profile = profileSchema.parse(profileExample);
  profileState.saveError = null;
  profileState.inUse = new Set();
  profileState.saved = [];
}
resetProfileState();

function fail(status: number, code: string, fields?: Record<string, string>) {
  return HttpResponse.json(errorResponse.parse({ error: { code, message: code, fields } }), {
    status,
  });
}

function invalid(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join('.')] = issue.message;
  return fail(400, 'VALIDATION_ERROR', fields);
}

let counter = 0;

export const handlers = [
  http.get('*/api/profile', () => HttpResponse.json(profileSchema.parse(profileState.profile))),

  http.put('*/api/profile', async ({ request }) => {
    const parsed = profileInput.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    const error = profileState.saveError;
    if (error) return fail(error.status, error.code, error.fields);
    profileState.saved.push(parsed.data);
    const { address, ...rest } = parsed.data;
    profileState.profile = { ...profileState.profile, ...rest, address };
    return HttpResponse.json(profileSchema.parse(profileState.profile));
  }),

  http.post('*/api/profile/products', async ({ request }) => {
    const parsed = productInput.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    const created = productSchema.parse({
      ...productExample,
      id: `0193a1b2-0000-7000-8000-${String(900 + counter++).padStart(12, '0')}`,
      ...parsed.data,
    });
    profileState.profile = {
      ...profileState.profile,
      products: [...profileState.profile.products, created],
    };
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put('*/api/profile/products/:id', async ({ request, params }) => {
    const parsed = productInput.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    const found = profileState.profile.products.find((p) => p.id === params.id);
    if (!found) return fail(404, 'NOT_FOUND');
    const updated = { ...found, ...parsed.data };
    profileState.profile = {
      ...profileState.profile,
      products: profileState.profile.products.map((p) => (p.id === found.id ? updated : p)),
    };
    return HttpResponse.json(productSchema.parse(updated));
  }),

  http.delete('*/api/profile/products/:id', ({ params }) => {
    const id = String(params.id);
    if (profileState.inUse.has(id)) return fail(409, 'PRODUCT_IN_USE');
    profileState.profile = {
      ...profileState.profile,
      products: profileState.profile.products.filter((p) => p.id !== id),
    };
    return new HttpResponse(null, { status: 204 });
  }),
];

export const productId = ids.product;
