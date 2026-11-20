import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FakeTotp } from '../test/fakes.js';
import { identityWorld, PASSWORD, signupDetails } from '../test/factories.js';

let w: ReturnType<typeof identityWorld>;
beforeEach(() => {
  w = identityWorld();
});

const ip = '1.1.1.1';

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

    const me = await w.verifyTwoFactor.execute({ token: sessionToken, code: FakeTotp.validCode, ip });
    expect(me.twoFactor).toEqual({ required: true, passed: true, setUp: true });
    const actor = await w.actorOf(sessionToken);
    expect(actor.roles).toEqual(['owner', 'staff']);
  });

  test('setup twice after it is confirmed is 409; later logins need a code', async () => {
    const { sessionToken, details } = await halfSignedInStaff();
    await w.setUpTwoFactor.execute({ token: sessionToken });
    await w.verifyTwoFactor.execute({ token: sessionToken, code: FakeTotp.validCode, ip });
    expect(await codeOf(w.setUpTwoFactor.execute({ token: sessionToken }))).toBe('CONFLICT');

    const next = await w.logIn.execute({ ...details, ip: '1.1.1.1' });
    expect(next.me.twoFactor).toEqual({ required: true, passed: false, setUp: true });
  });

  test('a wrong code is 401 INVALID_CODE; the 5th deletes the half-session (429)', async () => {
    const { sessionToken } = await halfSignedInStaff();
    await w.setUpTwoFactor.execute({ token: sessionToken });
    for (let i = 0; i < 4; i += 1) {
      expect(await codeOf(w.verifyTwoFactor.execute({ token: sessionToken, code: '000000', ip }))).toBe(
        'INVALID_CODE',
      );
    }
    expect(await codeOf(w.verifyTwoFactor.execute({ token: sessionToken, code: '000000', ip }))).toBe(
      'TOO_MANY_REQUESTS',
    );
    expect(
      await codeOf(w.verifyTwoFactor.execute({ token: sessionToken, code: FakeTotp.validCode, ip })),
    ).toBe('UNAUTHENTICATED');
  });

  test('a code that passed is not accepted again in its window (replay); the next code is', async () => {
    const staff = await w.staff();
    const email = staff.me.member.email;
    const again = await w.logIn.execute({ email, password: PASSWORD, ip: '1.1.1.1' });
    expect(
      await codeOf(
        w.verifyTwoFactor.execute({ token: again.sessionToken, code: FakeTotp.validCode, ip }),
      ),
    ).toBe('INVALID_CODE');
    w.s.clock.set(new Date(w.s.clock.now().getTime() + 30_000));
    const me = await w.verifyTwoFactor.execute({
      token: again.sessionToken,
      code: FakeTotp.validCode,
      ip,
    });
    expect(me.twoFactor.passed).toBe(true);
  });

  test('10 wrong codes an hour across sessions lock two-factor (TWO_FACTOR_LOCKED), audited once', async () => {
    const { details, sessionToken } = await halfSignedInStaff();
    await w.setUpTwoFactor.execute({ token: sessionToken });
    const outcomes: string[] = [];
    let token = sessionToken;
    for (let i = 0; i < 10; i += 1) {
      // A fresh half-session every 4 codes: logging in again must not reset the Member's limit.
      if (i > 0 && i % 4 === 0) token = (await w.logIn.execute({ ...details, ip })).sessionToken;
      outcomes.push(await codeOf(w.verifyTwoFactor.execute({ token, code: '000000', ip })));
    }
    expect(outcomes.slice(0, 9).every((o) => o === 'INVALID_CODE')).toBe(true);
    expect(outcomes[9]).toBe('TWO_FACTOR_LOCKED');
    const locked = w.s.audit.entries.filter((e) => e.action === 'two_factor.locked');
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({ targetType: 'member', details: { failures: 10 } });

    // Even the right code is refused until the hour has passed, with no second audit entry.
    const next = await w.logIn.execute({ ...details, ip });
    expect(
      await codeOf(
        w.verifyTwoFactor.execute({ token: next.sessionToken, code: FakeTotp.validCode, ip }),
      ),
    ).toBe('TWO_FACTOR_LOCKED');
    expect(w.s.audit.entries.filter((e) => e.action === 'two_factor.locked')).toHaveLength(1);

    w.s.clock.set(new Date(w.s.clock.now().getTime() + 61 * 60_000));
    const later = await w.logIn.execute({ ...details, ip });
    const me = await w.verifyTwoFactor.execute({
      token: later.sessionToken,
      code: FakeTotp.validCode,
      ip,
    });
    expect(me.twoFactor.passed).toBe(true);
  });

  test('concurrent guesses: at most 5 codes are checked per half-session, 10 per Member', async () => {
    const checked = vi.spyOn(w.s.totp, 'verify');
    const { details, sessionToken } = await halfSignedInStaff();
    await w.setUpTwoFactor.execute({ token: sessionToken });
    const burst = (token: string, n: number) =>
      Array.from({ length: n }, () =>
        codeOf(w.verifyTwoFactor.execute({ token, code: '000000', ip })),
      );

    const one = await Promise.all(burst(sessionToken, 20));
    expect(checked).toHaveBeenCalledTimes(5);
    expect(one.filter((o) => o === 'INVALID_CODE')).toHaveLength(4);

    const tokens = await Promise.all(
      [1, 2, 3].map(async () => (await w.logIn.execute({ ...details, ip })).sessionToken),
    );
    const many = await Promise.all(tokens.flatMap((t) => burst(t, 5)));
    // Codes counted before they are checked: the burst can't buy more than 10 checks an hour.
    expect(checked.mock.calls.length).toBeLessThanOrEqual(10);
    expect(many).toContain('TWO_FACTOR_LOCKED');
    expect(w.s.audit.entries.filter((e) => e.action === 'two_factor.locked')).toHaveLength(1);
  });

  test('verifying before setup is a conflict; non-Staff cannot use two-factor', async () => {
    const { sessionToken } = await halfSignedInStaff();
    expect(await codeOf(w.verifyTwoFactor.execute({ token: sessionToken, code: '123456', ip }))).toBe(
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
  test('setBusinessInternal by Staff audits in the same transaction; unknown Business audits nothing', async () => {
    const { identityQueriesFrom } = await import('./queries.js');
    const q = identityQueriesFrom(w.s);
    const a = await w.owner();
    const by = { staffMemberId: 'staff-1', action: 'business.updated', details: { internal: true } };

    w.s.audit.failNext = new Error('audit log down');
    await expect(q.setBusinessInternal(a.me.business.id, true, by)).rejects.toThrow(
      'audit log down',
    );
    expect((await q.getBusiness(a.me.business.id))?.internal).toBe(false);

    await q.setBusinessInternal(a.me.business.id, true, by);
    expect((await q.getBusiness(a.me.business.id))?.internal).toBe(true);
    expect(w.s.audit.entries).toEqual([
      {
        staffMemberId: 'staff-1',
        businessId: a.me.business.id,
        action: 'business.updated',
        targetType: 'business',
        targetId: a.me.business.id,
        details: { internal: true },
      },
    ]);

    expect(await codeOf(q.setBusinessInternal('missing', true, by))).toBe('NOT_FOUND');
    expect(w.s.audit.entries).toHaveLength(1);
  });

  test('getMemberEmails looks Members up in one batch, skipping unknown ids', async () => {
    const { identityQueriesFrom } = await import('./queries.js');
    const q = identityQueriesFrom(w.s);
    const a = await w.owner();
    const b = await w.owner();
    const emails = await q.getMemberEmails([a.me.member.id, b.me.member.id, a.me.member.id, 'x']);
    expect(emails).toEqual(
      new Map([
        [a.me.member.id, a.me.member.email],
        [b.me.member.id, b.me.member.email],
      ]),
    );
    expect(await q.getMemberEmails([])).toEqual(new Map());
  });


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
