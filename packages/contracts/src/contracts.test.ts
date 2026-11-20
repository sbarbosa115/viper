import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { assistantContracts } from './assistant.js';
import { billingContracts } from './billing.js';
import { pathFor, routePath, type Contract } from './common.js';
import { identityContracts } from './identity.js';
import { leadsContracts } from './leads.js';
import { planningContracts } from './planning.js';
import { platformContracts } from './platform.js';
import { profileContracts } from './profile.js';
import { reportingContracts } from './reporting.js';
import { researchContracts } from './research.js';
import { siteContracts } from './site.js';
import { toolsContracts } from './tools.js';

const all: Record<string, Contract> = {
  ...identityContracts,
  ...platformContracts,
  ...billingContracts,
  ...profileContracts,
  ...assistantContracts,
  ...planningContracts,
  ...researchContracts,
  ...toolsContracts,
  ...leadsContracts,
  ...reportingContracts,
  ...siteContracts,
};

/** Every endpoint in PRD section 7, in its order. */
const prdEndpoints = [
  // Identity
  'POST /api/auth/signup',
  'POST /api/auth/verify-email',
  'POST /api/auth/verify-email/resend',
  'POST /api/auth/login',
  'POST /api/auth/two-factor/setup',
  'POST /api/auth/two-factor/verify',
  'POST /api/auth/logout',
  'GET /api/auth/me',
  'POST /api/auth/password-reset',
  'POST /api/auth/password-reset/confirm',
  'PUT /api/auth/password',
  'POST /api/staff/acting-as',
  'DELETE /api/staff/acting-as',
  // Platform
  'GET /api/public/config',
  'GET /api/staff/settings',
  ...['ai', 'providers', 'email', 'stripe', 'analytics', 'ceilings', 'landing', 'support'].map(
    (s) => `PUT /api/staff/settings/${s}`,
  ),
  'POST /api/staff/settings/test',
  'GET /api/staff/audit-log',
  // Billing
  'GET /api/credits',
  'GET /api/credits/ledger',
  'POST /api/credits/checkout',
  'POST /api/webhooks/stripe',
  'POST /api/staff/businesses/:id/credits',
  'GET /api/staff/credit-packs',
  'POST /api/staff/credit-packs',
  'PUT /api/staff/credit-packs/:id',
  // Profile and assistant
  'GET /api/profile',
  'PUT /api/profile',
  'POST /api/profile/products',
  'PUT /api/profile/products/:id',
  'DELETE /api/profile/products/:id',
  'GET /api/conversations/welcome',
  'POST /api/conversations/:id/messages',
  // Planning
  'POST /api/plans',
  'GET /api/plans',
  'GET /api/plans/:id',
  'PATCH /api/plans/:id',
  'GET /api/places/search',
  // Research
  'POST /api/plans/:id/runs',
  'GET /api/runs/:id',
  'GET /api/plans/:id/runs',
  'POST /api/runs/:id/cancel',
  'POST /api/runs/:id/resume',
  'GET /api/staff/runs',
  'GET /api/staff/runs/:id',
  'POST /api/staff/runs/:id/resume',
  'GET /api/staff/queue',
  'GET /api/staff/flows',
  'GET /api/staff/flows/:key',
  'PUT /api/staff/flows/:key',
  // Site
  'GET /',
  'GET /terms',
  'GET /privacy',
  'GET /acceptable-use',
  'GET /cookies',
  'GET /sitemap.xml',
  'GET /robots.txt',
  'POST /site/signup',
  'POST /site/login',
  // Tools
  'GET /api/staff/tools',
  'PATCH /api/staff/tools/:key',
  // Leads
  'GET /api/plans/:id/leads',
  'GET /api/leads/:id',
  'PUT /api/leads/:id/feedback',
  'GET /api/plans/:id/leads.csv',
  // Reporting
  'GET /api/staff/dashboard',
  'GET /api/staff/businesses',
  'PATCH /api/staff/businesses/:id',
];

const key = (c: Contract) => `${c.method} ${c.path}`;

describe('contracts: coverage of PRD section 7', () => {
  test('every section 7 endpoint has exactly one contract', () => {
    const keys = Object.values(all).map(key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...prdEndpoints].sort());
  });

  test.each(Object.entries(all))('%s documents implied errors', (_name, c) => {
    const codes = c.errors.map((e) => `${e.status} ${e.code}`);
    if (c.auth !== 'public') expect(codes).toContain('401 UNAUTHENTICATED');
    if (c.auth === 'staff') expect(codes).toContain('403 TWO_FACTOR_REQUIRED');
    if (c.body || c.query || c.params) expect(codes).toContain('400 VALIDATION_ERROR');
  });

  test.each(Object.entries(all))('%s schemas convert to JSON Schema (OpenAPI docs)', (_name, c) => {
    for (const schema of [c.body, c.query, c.params]) {
      if (schema) expect(() => z.toJSONSchema(schema, { io: 'input' })).not.toThrow();
    }
    expect(() => z.toJSONSchema(c.response, { io: 'output' })).not.toThrow();
  });

  test.each(Object.entries(all))('%s path params match its params schema', (_name, c) => {
    const names = [...c.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);
    const shape = c.params instanceof z.ZodObject ? Object.keys(c.params.shape) : [];
    expect(shape.sort()).toEqual(names.sort());
  });
});

describe('contracts: path helpers', () => {
  test('routePath strips the /api prefix', () => {
    expect(routePath(planningContracts.getPlan)).toBe('/plans/:id');
    expect(routePath(siteContracts.landingPage)).toBe('/');
  });

  test('pathFor fills and encodes params, and rejects missing ones', () => {
    expect(pathFor(toolsContracts.updateTool, { key: 'google.places' })).toBe(
      '/api/staff/tools/google.places',
    );
    expect(() => pathFor(planningContracts.getPlan)).toThrow(/id/);
  });
});
