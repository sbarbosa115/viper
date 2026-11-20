import { auditLogEntry } from '@app/contracts/platform';
import { beforeEach, describe, expect, test } from 'vitest';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import {
  FakeAuditDirectory,
  InMemoryAuditLogRepository,
  ids,
  ownerActor,
  staffActor,
} from '../test/fakes.js';
import { AuditLog, ListAuditLog } from './audit-log.js';

let repository: InMemoryAuditLogRepository;
let clock: FixedClock;
let audit: AuditLog;
let directory: FakeAuditDirectory;
let list: ListAuditLog;

beforeEach(() => {
  repository = new InMemoryAuditLogRepository();
  clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
  audit = new AuditLog({ repository, clock, ids: new SequentialIdGenerator() });
  directory = new FakeAuditDirectory(
    new Map([[ids.staff, { email: 'staff@demo.test' }]]),
    new Map([[ids.business, { name: 'Sweet Supply Co' }]]),
  );
  list = new ListAuditLog({ repository, directory });
});

async function recordMany(n: number, action = 'plan.updated'): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    clock.set(new Date(Date.UTC(2026, 10, 19, 10, 0, i)));
    await audit.record({
      staffMemberId: ids.staff,
      businessId: ids.business,
      action,
      targetType: 'plan',
      targetId: `plan-${i}`,
    });
  }
}

describe('FR-7: record Audit log entries', () => {
  test('appends an entry with time, Staff, Business, action, target and details', async () => {
    await audit.record({
      staffMemberId: ids.staff,
      businessId: ids.business,
      action: 'acting_as.started',
      targetType: 'business',
      targetId: ids.business,
      details: { reason: 'support' },
    });
    expect(repository.entries).toEqual([
      {
        id: expect.any(String) as string,
        at: new Date('2026-11-19T10:00:00.000Z'),
        staffMemberId: ids.staff,
        businessId: ids.business,
        action: 'acting_as.started',
        targetType: 'business',
        targetId: ids.business,
        details: { reason: 'support' },
      },
    ]);
  });

  test('never stores secret values in details', async () => {
    await audit.record({
      staffMemberId: ids.staff,
      businessId: null,
      action: 'settings.email.updated',
      targetType: 'settings',
      targetId: 'email',
      details: { fields: ['password'], password: 'p@ss-1234' },
    });
    expect(JSON.stringify(repository.entries)).not.toContain('p@ss-1234');
    expect(repository.entries[0]?.details).toEqual({ fields: ['password'] });
  });
});

describe('FR-7: list the Audit log', () => {
  test('newest first, with Staff email and Business name, parsing against the contract', async () => {
    await recordMany(3);
    const page = await list.execute({ actor: staffActor(), filter: {}, limit: 50 });
    expect(page.items.map((e) => e.targetId)).toEqual(['plan-2', 'plan-1', 'plan-0']);
    expect(page.nextCursor).toBeNull();
    const first = auditLogEntry.parse(page.items[0]);
    expect(first.staff).toEqual({ id: ids.staff, email: 'staff@demo.test' });
    expect(first.business).toEqual({ id: ids.business, name: 'Sweet Supply Co' });
    expect(directory.lookups).toBe(1);
  });

  test('cursor pagination walks every entry exactly once', async () => {
    await recordMany(5);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await list.execute({ actor: staffActor(), filter: {}, cursor, limit: 2 });
      seen.push(...page.items.map((e) => e.targetId ?? ''));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(['plan-4', 'plan-3', 'plan-2', 'plan-1', 'plan-0']);
  });

  test('filters by Business, Staff Member and action', async () => {
    await recordMany(2, 'plan.updated');
    await recordMany(1, 'run.started');
    await audit.record({
      staffMemberId: ids.staff,
      businessId: null,
      action: 'tool.updated',
      targetType: 'tool',
      targetId: 'places',
    });
    const byAction = await list.execute({
      actor: staffActor(),
      filter: { action: 'run.started' },
      limit: 50,
    });
    expect(byAction.items).toHaveLength(1);
    const byBusiness = await list.execute({
      actor: staffActor(),
      filter: { businessId: ids.business },
      limit: 50,
    });
    expect(byBusiness.items).toHaveLength(3);
    const byStaff = await list.execute({
      actor: staffActor(),
      filter: { staffMemberId: ids.owner },
      limit: 50,
    });
    expect(byStaff.items).toHaveLength(0);
  });

  test('entries without a Business show business null', async () => {
    await audit.record({
      staffMemberId: ids.staff,
      businessId: null,
      action: 'tool.updated',
      targetType: 'tool',
      targetId: 'places',
    });
    const page = await list.execute({ actor: staffActor(), filter: {}, limit: 50 });
    expect(page.items[0]?.business).toBeNull();
  });

  test('an invalid cursor is a validation error', async () => {
    await expect(
      list.execute({ actor: staffActor(), filter: {}, cursor: 'not-a-cursor', limit: 50 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('a non-Staff Member gets FORBIDDEN', async () => {
    await expect(
      list.execute({ actor: ownerActor(), filter: {}, limit: 50 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
