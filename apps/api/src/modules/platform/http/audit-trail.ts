import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuditRecorder } from '../application/audit-log.js';
import { auditTargetFor } from '../domain/audit-action.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Audit log for writes made while Acting as (FR-7). Omit to derive the action from the route
     * (`PUT /api/plans/:id` → `plan.updated`), name it explicitly, or `false` to skip a route
     * whose use case records its own entry.
     */
    audit?: false | { action: string; targetType?: string };
  }
}

function fieldNames(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return [];
  return Object.keys(body).sort();
}

function stringParams(params: unknown): Record<string, string> {
  if (typeof params !== 'object' || params === null) return {};
  return Object.fromEntries(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

function auditFor(req: FastifyRequest, statusCode: number) {
  const actingAs = req.actor?.actingAs;
  const route = req.routeOptions.url;
  if (!actingAs || !route || statusCode < 200 || statusCode >= 300) return null;
  const override = req.routeOptions.config.audit;
  if (override === false) return null;
  const derived = auditTargetFor(req.method, route, stringParams(req.params));
  if (!derived) return null;
  return {
    staffMemberId: actingAs.staffMemberId,
    businessId: actingAs.businessId,
    action: override?.action ?? derived.action,
    targetType: override?.targetType ?? derived.targetType,
    targetId: derived.targetId,
    // Names only: request values may hold personal data or secrets.
    details: { method: req.method, route, fields: fieldNames(req.body) },
  };
}

/**
 * Records every successful state-changing request made while Acting as (FR-6, FR-7). Register it
 * on the root instance, before the modules, so the hook reaches every module's routes. A failed
 * write is logged; the customer's request has already succeeded.
 */
export function registerAuditTrail(app: FastifyInstance, deps: { audit: AuditRecorder }): void {
  app.addHook('onResponse', async (req, reply) => {
    const entry = auditFor(req, reply.statusCode);
    if (!entry) return;
    try {
      await deps.audit.record(entry);
    } catch (err) {
      req.log.error({ err, action: entry.action }, 'audit log write failed');
    }
  });
}
