import { describe, expect, test } from 'vitest';
import { auditTargetFor, scrubAuditDetails } from './audit-action.js';

const id = '00000000-0000-7000-8000-000000000001';

describe('FR-7: audit action from the route', () => {
  test.each([
    ['PUT', '/api/plans/:id', 'plan.updated', 'plan'],
    ['PATCH', '/api/plans/:id', 'plan.updated', 'plan'],
    ['DELETE', '/api/profile/products/:id', 'product.deleted', 'product'],
    ['POST', '/api/plans/:id/runs', 'run.started', 'plan'],
    ['POST', '/api/runs/:id/cancel', 'run.cancelled', 'run'],
    ['POST', '/api/runs/:id/resume', 'run.resumed', 'run'],
    ['POST', '/api/leads/:id/feedback', 'lead.feedback_given', 'lead'],
    ['POST', '/api/conversations/:id/messages', 'message.created', 'conversation'],
  ])('%s %s → %s', (method, route, action, targetType) => {
    expect(auditTargetFor(method, route, { id })).toEqual({ action, targetType, targetId: id });
  });

  test.each([
    ['POST', '/api/plans', 'plan.created', 'plan'],
    ['PUT', '/api/profile', 'profile.updated', 'profile'],
    ['POST', '/api/profile/products', 'product.created', 'product'],
    ['POST', '/api/credit-packs', 'credit_pack.created', 'credit_pack'],
  ])('%s %s → %s without a target id', (method, route, action, targetType) => {
    expect(auditTargetFor(method, route, {})).toEqual({ action, targetType, targetId: null });
  });

  test.each([
    ['GET', '/api/plans/:id'],
    ['PUT', '/api/staff/settings/ai'],
    ['POST', '/api/staff/acting-as'],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/webhooks/stripe'],
  ])('%s %s is not audited by the hook', (method, route) => {
    expect(auditTargetFor(method, route, { id })).toBeNull();
  });
});

describe('FR-7: audit details never hold secrets', () => {
  test('keys naming secrets are dropped, field-name lists are kept', () => {
    expect(
      scrubAuditDetails({
        fields: ['anthropicApiKey', 'password'],
        password: 'hunter22',
        nested: { apiKey: 'sk-1', note: 'ok' },
        authToken: 'x',
      }),
    ).toEqual({ fields: ['anthropicApiKey', 'password'], nested: { note: 'ok' } });
  });
});
