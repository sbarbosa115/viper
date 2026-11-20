import { z } from 'zod';
import { defineContract, err, id, idParams, noContent } from './common.js';
import { businessName } from './identity.js';

// Shapes -----------------------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max);

export const product = z.object({
  id,
  name: z.string(),
  description: z.string(),
});
export type Product = z.infer<typeof product>;

export const productInput = z.object({
  name: text(120).min(1),
  description: text(500).default(''),
});
export type ProductInput = z.input<typeof productInput>;

/** US addresses only in this version; each line may be null while the profile is incomplete. */
export const address = z.object({
  line1: text(200).nullable(),
  city: text(100).nullable(),
  state: text(50).nullable(),
  postalCode: text(20).nullable(),
  country: z.literal('US'),
});
export type Address = z.infer<typeof address>;

export const geoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** The geocoded location of the Business. */
export const location = geoPoint.extend({ label: z.string() });
export type Location = z.infer<typeof location>;

export const profile = z.object({
  businessName: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  address,
  location: location.nullable(),
  deliveryRadiusMiles: z.number().min(0).max(100).nullable(),
  currentCustomers: z.string().nullable(),
  priceRange: z.string().nullable(),
  website: z.string().nullable(),
  products: z.array(product),
  /** ≥ 1 Product, a geocoded location and a delivery radius (FR-14). */
  complete: z.boolean(),
});
export type Profile = z.infer<typeof profile>;

/** FR-15 limits. Renaming the Business goes through identity's public API. */
export const profileInput = z.object({
  businessName,
  description: text(500).nullable(),
  category: text(80).nullable(),
  address,
  deliveryRadiusMiles: z.number().min(0).max(100).nullable(),
  currentCustomers: text(500).nullable(),
  priceRange: text(120).nullable(),
  website: z.url().max(2048).nullable(),
});
export type ProfileInput = z.infer<typeof profileInput>;

// Endpoints --------------------------------------------------------------------------------------

export const getProfile = defineContract({
  method: 'GET',
  path: '/api/profile',
  auth: 'session',
  status: 200,
  response: profile,
});

/** FR-15. Saving geocodes a changed address. */
export const updateProfile = defineContract({
  method: 'PUT',
  path: '/api/profile',
  auth: 'session',
  status: 200,
  body: profileInput,
  response: profile,
  errors: [err(422, 'ADDRESS_NOT_FOUND')],
});

export const createProduct = defineContract({
  method: 'POST',
  path: '/api/profile/products',
  auth: 'session',
  status: 201,
  body: productInput,
  response: product,
});

export const updateProduct = defineContract({
  method: 'PUT',
  path: '/api/profile/products/:id',
  auth: 'session',
  status: 200,
  params: idParams,
  body: productInput,
  response: product,
  errors: [err(404, 'NOT_FOUND')],
});

/** 409 PRODUCT_IN_USE when a Plan segment pitches it. */
export const deleteProduct = defineContract({
  method: 'DELETE',
  path: '/api/profile/products/:id',
  auth: 'session',
  status: 204,
  params: idParams,
  response: noContent,
  errors: [err(404, 'NOT_FOUND'), err(409, 'PRODUCT_IN_USE')],
});

export const profileContracts = {
  getProfile,
  updateProfile,
  createProduct,
  updateProduct,
  deleteProduct,
} as const;
