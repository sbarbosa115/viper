import { customer as customerContract } from '@app/contracts/reporting';
import { describe, expect, test } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { dashboardWorld, IDS } from '../test/fixture.js';
import { fakeDeps, ownerActor, staffActor } from '../test/fakes.js';
import { ListCustomers, MarkBusinessInternal } from './customers.js';

describe('FR-31: customer list', () => {
  test('rows carry every column, from identity, billing, research and leads', async () => {
    const page = await new ListCustomers(fakeDeps(dashboardWorld())).execute({
      actor: staffActor,
      q: 'sweet',
      sort: 'signedUp',
      limit: 50,
    });
    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual([
      {
        id: IDS.sweet,
        name: 'Sweet Supply Co',
        ownerEmail: 'owner@demo.test',
        signedUpAt: '2026-09-01T00:00:00.000Z',
        verified: true,
        availableCredits: 1_913, // 2,313 balance − 400 reserved
        runs: 4,
        leadsDelivered: 50,
        lastActiveAt: '2026-11-20T14:00:00.000Z',
        paying: true,
        internal: false,
      },
    ]);
    expect(customerContract.parse(page.items[0])).toEqual(page.items[0]);
  });

  test('search "bakery" shows only matching Businesses (name or Owner email)', async () => {
    const list = new ListCustomers(fakeDeps(dashboardWorld()));
    const byName = await list.execute({
      actor: staffActor,
      q: 'bakery',
      sort: 'signedUp',
      limit: 50,
    });
    expect(byName.items.map((c) => c.name)).toEqual(['Bakery Supplies Ltd']);
    const byEmail = await list.execute({
      actor: staffActor,
      q: 'low@',
      sort: 'signedUp',
      limit: 50,
    });
    expect(byEmail.items.map((c) => c.name)).toEqual(['Corner Coffee Roasters']);
  });

  test('sorts by signed up (default) or last active, and pages by cursor', async () => {
    const list = new ListCustomers(fakeDeps(dashboardWorld()));
    const first = await list.execute({ actor: staffActor, sort: 'signedUp', limit: 3 });
    expect(first.items.map((c) => c.name)).toEqual([
      'Bakery Supplies Ltd',
      'Clean Desk Co',
      'QA Test Co',
    ]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list.execute({
      actor: staffActor,
      sort: 'signedUp',
      limit: 3,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    expect(second.items.map((c) => c.name)).toEqual([
      'Austin Bagels',
      'Corner Coffee Roasters',
      'Sweet Supply Co',
    ]);
    const active = await list.execute({ actor: staffActor, sort: 'lastActive', limit: 2 });
    expect(active.items.map((c) => c.name)).toEqual(['Sweet Supply Co', 'Llyner Leads (internal)']);
  });

  test('only Staff', async () => {
    await expect(
      new ListCustomers(fakeDeps(dashboardWorld())).execute({
        actor: ownerActor,
        sort: 'signedUp',
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('FR-31: mark internal', () => {
  test('marks the Business internal, writes the Audit log and returns the row', async () => {
    const deps = fakeDeps(dashboardWorld());
    const row = await new MarkBusinessInternal(deps).execute({
      actor: staffActor,
      businessId: IDS.corner,
      internal: true,
    });
    expect(row).toMatchObject({
      id: IDS.corner,
      internal: true,
      paying: true,
      runs: 2,
      leadsDelivered: 20,
    });
    expect(customerContract.parse(row)).toEqual(row);
    expect(deps.audit.entries).toEqual([
      {
        staffMemberId: staffActor.memberId,
        businessId: IDS.corner,
        action: 'business.updated',
        targetType: 'business',
        targetId: IDS.corner,
        details: { fields: ['internal'], internal: true },
      },
    ]);
    expect((await deps.identity.allBusinesses()).find((b) => b.id === IDS.corner)?.internal).toBe(
      true,
    );
  });

  test('unknown Business: not found, nothing audited', async () => {
    const deps = fakeDeps(dashboardWorld());
    await expect(
      new MarkBusinessInternal(deps).execute({
        actor: staffActor,
        businessId: '00000000-0000-4000-8000-00000000ffff',
        internal: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(deps.audit.entries).toEqual([]);
  });

  test('the change and its Audit entry are one transaction: a failed audit write changes nothing', async () => {
    const deps = fakeDeps(dashboardWorld());
    deps.audit.failNext = new Error('audit log down');
    await expect(
      new MarkBusinessInternal(deps).execute({
        actor: staffActor,
        businessId: IDS.corner,
        internal: true,
      }),
    ).rejects.toThrow('audit log down');
    expect((await deps.identity.allBusinesses()).find((b) => b.id === IDS.corner)?.internal).toBe(
      false,
    );
  });

  test('only Staff', async () => {
    const deps = fakeDeps(dashboardWorld());
    await expect(
      new MarkBusinessInternal(deps).execute({
        actor: ownerActor,
        businessId: IDS.sweet,
        internal: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(deps.audit.entries).toEqual([]);
  });
});
