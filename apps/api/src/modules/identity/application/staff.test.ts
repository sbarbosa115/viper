import { beforeEach, describe, expect, test } from 'vitest';
import { FakeTotp } from '../test/fakes.js';
import { identityWorld, PASSWORD, signupDetails } from '../test/factories.js';

let w: ReturnType<typeof identityWorld>;
beforeEach(() => {
  w = identityWorld();
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? 'UNKNOWN';
  }
}

/** A Member made Staff by the server command, logged in with the password only. */
async function halfSignedInStaff() {
  const details = signupDetails();
  await w.signUp.execute(details);
  await w.runStaffCommand.execute({ command: 'grant', email: details.email });
  const half = await w.logIn.execute({ ...details, ip: '1.1.1.1' });
  return { details, ...half };
}

describe('FR-5: Staff accounts and two-factor sign-in', () => {
  test('a correct Staff password gives a half-session: twoFactor required, not passed', async () => {
    const { me, sessionToken } = await halfSignedInStaff();
    expect(me.twoFactor).toEqual({ required: true, passed: false, setUp: false });
    expect(me.member.isStaff).toBe(true);
    // Only the two-factor endpoints: no Actor for customer endpoints.
    expect(await w.resolveActor.execute({ token: sessionToken, path: '/api/plans' })).toBeNull();
  });

  test('without the code, back-office paths are 403 TWO_FACTOR_REQUIRED', async () => {
    const { sessionToken } = await halfSignedInStaff();
    const resolve = w.resolveActor.execute({ token: sessionToken, path: '/api/staff/settings' });
    expect(await codeOf(resolve)).toBe('TWO_FACTOR_REQUIRED');
  });

  test('first login: setup returns the QR code and secret; a valid code passes and confirms setup', async () => {
    const { sessionToken } = await halfSignedInStaff();
    const setup = await w.setUpTwoFactor.execute({ token: sessionToken });
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\//);
    expect(setup.secret).toBe(new FakeTotp().generateSecret());
    expect(setup.qrSvg).toContain('<svg');
    // Stored encrypted, never in clear.
    const stored = [...w.s.store.members.values()][0]?.totpSecretEnc;
    expect(stored).toBe(`enc:${setup.secret}`);

    const me = await w.verifyTwoFactor.execute({ token: sessionToken, code: FakeTotp.validCode });
    expect(me.twoFactor).toEqual({ required: true, passed: true, setUp: true });
    const actor = await w.actorOf(sessionToken);
    expect(actor.roles).toEqual(['owner', 'staff']);
  });

  test('setup twice after it is confirmed is 409; later logins need a code', async () => {
    const { sessionToken, details } = await halfSignedInStaff();
    await w.setUpTwoFactor.execute({ token: sessionToken });
    await w.verifyTwoFactor.execute({ token: sessionToken, code: FakeTotp.validCode });
    expect(await codeOf(w.setUpTwoFactor.execute({ token: sessionToken }))).toBe('CONFLICT');

    const next = await w.logIn.execute({ ...details, ip: '1.1.1.1' });
    expect(next.me.twoFactor).toEqual({ required: true, passed: false, setUp: true });
  });

  test('a wrong code is 401 INVALID_CODE; the 5th deletes the half-session (429)', async () => {
    const { sessionToken } = await halfSignedInStaff();
    await w.setUpTwoFactor.execute({ token: sessionToken });
    for (let i = 0; i < 4; i += 1) {
      expect(await codeOf(w.verifyTwoFactor.execute({ token: sessionToken, code: '000000' }))).toBe(
        'INVALID_CODE',
      );
    }
    expect(await codeOf(w.verifyTwoFactor.execute({ token: sessionToken, code: '000000' }))).toBe(
      'TOO_MANY_REQUESTS',
    );
    expect(
      await codeOf(w.verifyTwoFactor.execute({ token: sessionToken, code: FakeTotp.validCode })),
    ).toBe('UNAUTHENTICATED');
  });

  test('verifying before setup is a conflict; non-Staff cannot use two-factor', async () => {
    const { sessionToken } = await halfSignedInStaff();
    expect(await codeOf(w.verifyTwoFactor.execute({ token: sessionToken, code: '123456' }))).toBe(
      'CONFLICT',
    );
    const owner = await w.owner();
    expect(await codeOf(w.setUpTwoFactor.execute({ token: owner.sessionToken }))).toBe('FORBIDDEN');
  });

  test('staff:revoke clears Staff and deletes their sessions', async () => {
    const staff = await w.staff();
    await w.runStaffCommand.execute({ command: 'revoke', email: staff.me.member.email });
    expect(await w.resolveActor.execute({ token: staff.sessionToken, path: '/' })).toBeNull();
    const again = await w.logIn.execute({
      email: staff.me.member.email,
      password: PASSWORD,
      ip: '1.1.1.1',
    });
    expect(again.me.member.isStaff).toBe(false);
    expect((await w.actorOf(again.sessionToken)).roles).toEqual(['owner']);
  });

  test('staff:reset-2fa clears the secret: the next login sets it up again', async () => {
    const staff = await w.staff();
    await w.runStaffCommand.execute({ command: 'reset-2fa', email: staff.me.member.email });
    expect(await w.resolveActor.execute({ token: staff.sessionToken, path: '/' })).toBeNull();
    const again = await w.logIn.execute({
      email: staff.me.member.email,
      password: PASSWORD,
      ip: '1.1.1.1',
    });
    expect(again.me.twoFactor.setUp).toBe(false);
  });

  test('staff commands on an unknown email are NOT_FOUND', async () => {
    expect(await codeOf(w.runStaffCommand.execute({ command: 'grant', email: 'x@y.co' }))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('FR-6: Acting as a Business', () => {
  test('Staff Acting as B resolve as B, with actingAs set; me shows B and actingAs', async () => {
    const staff = await w.staff();
    const b = await w.owner({ businessName: 'Sweet Supply Co' });
    const me = await w.startActingAs.execute({
      actor: await w.actorOf(staff.sessionToken),
      token: staff.sessionToken,
      businessId: b.me.business.id,
    });
    expect(me.actingAs).toEqual({ businessId: b.me.business.id, businessName: 'Sweet Supply Co' });
    expect(me.business).toEqual(b.me.business);
    expect(me.member.id).toBe(staff.me.member.id);

    const actor = await w.actorOf(staff.sessionToken);
    expect(actor).toEqual({
      memberId: staff.me.member.id,
      businessId: b.me.business.id,
      roles: ['owner', 'staff'],
      emailVerified: false,
      actingAs: {
        businessId: b.me.business.id,
        businessName: 'Sweet Supply Co',
        staffMemberId: staff.me.member.id,
      },
    });
    expect(w.s.audit.entries).toEqual([
      {
        staffMemberId: staff.me.member.id,
        businessId: b.me.business.id,
        action: 'acting_as.started',
        targetType: 'business',
        targetId: b.me.business.id,
        details: {},
      },
    ]);
    expect(w.s.analytics.events.at(-1)).toMatchObject({
      name: 'acting_as_started',
      properties: { staff_member_id: staff.me.member.id, business_id: b.me.business.id },
    });
  });

  test('cross-Business: an Owner always resolves to their own Business and cannot act as another', async () => {
    const a = await w.owner();
    const b = await w.owner();
    expect((await w.actorOf(a.sessionToken)).businessId).toBe(a.me.business.id);
    const attempt = w.startActingAs.execute({
      actor: await w.actorOf(a.sessionToken),
      token: a.sessionToken,
      businessId: b.me.business.id,
    });
    expect(await codeOf(attempt)).toBe('FORBIDDEN');
    expect((await w.actorOf(a.sessionToken)).businessId).toBe(a.me.business.id);
  });

  test('an unknown Business is 404', async () => {
    const staff = await w.staff();
    const attempt = w.startActingAs.execute({
      actor: await w.actorOf(staff.sessionToken),
      token: staff.sessionToken,
      businessId: '00000000-0000-7000-8000-00000000ffff',
    });
    expect(await codeOf(attempt)).toBe('NOT_FOUND');
  });

  test('changing the password while Acting as is 403 ACTING_AS_FORBIDDEN', async () => {
    const staff = await w.staff();
    const b = await w.owner();
    await w.startActingAs.execute({
      actor: await w.actorOf(staff.sessionToken),
      token: staff.sessionToken,
      businessId: b.me.business.id,
    });
    const attempt = w.changePassword.execute({
      actor: await w.actorOf(staff.sessionToken),
      sessionToken: staff.sessionToken,
      currentPassword: PASSWORD,
      newPassword: 'a brand new password',
    });
    expect(await codeOf(attempt)).toBe('ACTING_AS_FORBIDDEN');
  });

  test('starting another Business replaces the first (stop then start logged)', async () => {
    const staff = await w.staff();
    const b = await w.owner();
    const c = await w.owner();
    const start = async (businessId: string) =>
      w.startActingAs.execute({
        actor: await w.actorOf(staff.sessionToken),
        token: staff.sessionToken,
        businessId,
      });
    await start(b.me.business.id);
    await start(c.me.business.id);
    expect((await w.actorOf(staff.sessionToken)).businessId).toBe(c.me.business.id);
    expect(w.s.audit.entries.map((e) => [e.action, e.businessId])).toEqual([
      ['acting_as.started', b.me.business.id],
      ['acting_as.stopped', b.me.business.id],
      ['acting_as.started', c.me.business.id],
    ]);
  });

  test('stopping shows the Staff own Business again, with start and stop in the Audit log', async () => {
    const staff = await w.staff();
    const b = await w.owner();
    await w.startActingAs.execute({
      actor: await w.actorOf(staff.sessionToken),
      token: staff.sessionToken,
      businessId: b.me.business.id,
    });
    const me = await w.stopActingAs.execute({
      actor: await w.actorOf(staff.sessionToken),
      token: staff.sessionToken,
    });
    expect(me.actingAs).toBeNull();
    expect(me.business).toEqual(staff.me.business);
    expect((await w.actorOf(staff.sessionToken)).businessId).toBe(staff.me.business.id);
    expect(w.s.audit.entries.map((e) => e.action)).toEqual([
      'acting_as.started',
      'acting_as.stopped',
    ]);
  });

  test('logging out ends Acting as (logged as stopped)', async () => {
    const staff = await w.staff();
    const b = await w.owner();
    await w.startActingAs.execute({
      actor: await w.actorOf(staff.sessionToken),
      token: staff.sessionToken,
      businessId: b.me.business.id,
    });
    await w.logOut.execute({ token: staff.sessionToken });
    expect(w.s.audit.entries.at(-1)).toMatchObject({
      action: 'acting_as.stopped',
      businessId: b.me.business.id,
      details: { reason: 'logout' },
    });
  });

  test('a Staff half-session cannot start Acting as', async () => {
    const { sessionToken } = await halfSignedInStaff();
    const b = await w.owner();
    const actor = await w.resolveActor.execute({ token: sessionToken, path: '/api/plans' });
    const attempt = w.startActingAs.execute({
      actor,
      token: sessionToken,
      businessId: b.me.business.id,
    });
    expect(await codeOf(attempt)).toBe('FORBIDDEN');
  });
});

describe('identity public queries', () => {
  test('getOwnerContact, renameBusiness, setBusinessInternal and listBusinesses', async () => {
    const { identityQueriesFrom } = await import('./queries.js');
    const q = identityQueriesFrom(w.s);
    const a = await w.owner({ businessName: 'Sweet Bakery Supply' });
    w.s.clock.set(new Date(w.s.clock.now().getTime() + 1000));
    const b = await w.owner({ businessName: 'Clean Desk Co' });

    expect(await q.getOwnerContact(a.me.business.id)).toEqual({
      email: a.me.member.email,
      name: a.me.member.name,
      emailVerified: false,
    });
    await q.renameBusiness(a.me.business.id, '  Sweet Supply Co ');
    expect((await q.getBusiness(a.me.business.id))?.name).toBe('Sweet Supply Co');
    expect(await codeOf(q.renameBusiness(a.me.business.id, 'x'))).toBe('VALIDATION_ERROR');
    expect(await codeOf(q.renameBusiness('missing', 'Fine name'))).toBe('NOT_FOUND');
    await q.setBusinessInternal(b.me.business.id, true);
    expect((await q.getBusinesses([b.me.business.id, b.me.business.id]))[0]?.internal).toBe(true);

    const all = await q.listBusinesses({ sort: 'signedUp', limit: 1 });
    expect(all.items.map((i) => i.id)).toEqual([b.me.business.id]);
    const next = await q.listBusinesses({
      sort: 'signedUp',
      limit: 1,
      cursor: all.nextCursor ?? '',
    });
    expect(next.items.map((i) => i.id)).toEqual([a.me.business.id]);
    expect(next.nextCursor).toBeNull();
    const found = await q.listBusinesses({ sort: 'signedUp', limit: 50, q: 'sweet' });
    expect(found.items.map((i) => i.name)).toEqual(['Sweet Supply Co']);
  });
});
