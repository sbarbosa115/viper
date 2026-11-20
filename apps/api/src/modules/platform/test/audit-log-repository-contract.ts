import { beforeEach, describe, expect, test } from 'vitest';
import type { AuditEntry, AuditLogRepository } from '../application/ports.js';
import { ids } from './fakes.js';

const entry = (n: number, overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  id: `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`,
  at: new Date(Date.UTC(2026, 10, 19, 10, 0, Math.floor(n / 2))),
  staffMemberId: ids.staff,
  businessId: ids.business,
  action: 'plan.updated',
  targetType: 'plan',
  targetId: `plan-${n}`,
  details: { fields: ['name'] },
  ...overrides,
});

/** One suite for every AuditLogRepository, so the in-memory fake stays honest. */
export function auditLogRepositoryContract(
  name: string,
  make: () => Promise<AuditLogRepository> | AuditLogRepository,
): void {
  describe(`FR-7: AuditLogRepository contract (${name})`, () => {
    let repo: AuditLogRepository;
    beforeEach(async () => {
      repo = await make();
    });

    test('round-trips an entry', async () => {
      const e = entry(1, { businessId: null, targetId: null, details: { a: [1, 'x'] } });
      await repo.append(e);
      expect(await repo.list({}, null, 10)).toEqual([e]);
    });

    test('lists newest first with ties broken by id, and pages with a cursor', async () => {
      for (const n of [1, 2, 3, 4, 5]) await repo.append(entry(n));
      const all = await repo.list({}, null, 10);
      expect(all.map((e) => e.targetId)).toEqual([
        'plan-5',
        'plan-4',
        'plan-3',
        'plan-2',
        'plan-1',
      ]);
      const last = all[1];
      if (!last) throw new Error('expected entries');
      const next = await repo.list({}, { at: last.at, id: last.id }, 2);
      expect(next.map((e) => e.targetId)).toEqual(['plan-3', 'plan-2']);
    });

    test('filters by Business, Staff Member and action', async () => {
      await repo.append(entry(1));
      await repo.append(entry(2, { businessId: null, action: 'tool.updated' }));
      await repo.append(entry(3, { staffMemberId: ids.owner }));
      expect(await repo.list({ businessId: ids.business }, null, 10)).toHaveLength(2);
      expect(await repo.list({ staffMemberId: ids.owner }, null, 10)).toHaveLength(1);
      expect(await repo.list({ action: 'tool.updated' }, null, 10)).toHaveLength(1);
    });
  });
}
