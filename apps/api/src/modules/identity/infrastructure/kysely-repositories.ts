import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import type {
  BusinessDirectory,
  BusinessListItem,
  BusinessListQuery,
  BusinessRepository,
  EmailTokenRepository,
  IdentityRepos,
  LoginAttempt,
  LoginAttemptRepository,
  MemberRepository,
  SessionRepository,
} from '../application/ports.js';
import { Business } from '../domain/business.js';
import { EmailToken, type EmailTokenPurpose } from '../domain/email-token.js';
import { identityErrors } from '../domain/errors.js';
import { Member } from '../domain/member.js';
import { Session } from '../domain/session.js';
import { SIGNUP_MARKER } from './markers.js';
import type { MembersTable } from './tables.js';

type Db = Kysely<DB> | Transaction<DB>;

// Mappers ----------------------------------------------------------------------------------------

function toMember(row: Selectable<MembersTable>): Member {
  return Member.restore({
    id: row.id,
    businessId: row.business_id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    role: row.role,
    isStaff: row.is_staff === 1,
    emailVerifiedAt: row.email_verified_at,
    totpSecretEnc: row.totp_secret_enc ? row.totp_secret_enc.toString('utf8') : null,
    totpEnabledAt: row.totp_enabled_at,
    createdAt: row.created_at,
  });
}

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

// Repositories -----------------------------------------------------------------------------------

export class KyselyBusinessRepository implements BusinessRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Business | null> {
    const [found] = await this.findByIds([id]);
    return found ?? null;
  }

  async findByIds(ids: readonly string[]): Promise<Business[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .selectFrom('businesses')
      .selectAll()
      .where('id', 'in', [...ids])
      .execute();
    return rows.map((r) =>
      Business.restore({
        id: r.id,
        name: r.name,
        internal: r.internal === 1,
        createdAt: r.created_at,
        lastActiveAt: r.last_active_at,
      }),
    );
  }

  async save(business: Business): Promise<void> {
    const s = business.toSnapshot();
    await this.db
      .insertInto('businesses')
      .values({
        id: s.id,
        name: s.name,
        internal: s.internal,
        created_at: s.createdAt,
        last_active_at: s.lastActiveAt,
      })
      .onDuplicateKeyUpdate({ name: s.name, internal: s.internal })
      .execute();
  }

  async touchActivity(id: string, at: Date): Promise<void> {
    await this.db
      .updateTable('businesses')
      .set({ last_active_at: at })
      .where('id', '=', id)
      .execute();
  }
}

export class KyselyMemberRepository implements MemberRepository {
  constructor(private readonly db: Db) {}

  private async one(column: 'id' | 'email' | 'business_id', value: string) {
    const row = await this.db
      .selectFrom('members')
      .selectAll()
      .where(column, '=', value)
      .orderBy('created_at')
      .limit(1)
      .executeTakeFirst();
    return row ? toMember(row) : null;
  }

  findById(id: string): Promise<Member | null> {
    return this.one('id', id);
  }

  findByEmail(email: string): Promise<Member | null> {
    return this.one('email', email);
  }

  findOwnerOf(businessId: string): Promise<Member | null> {
    return this.one('business_id', businessId);
  }

  async findOwnersOf(businessIds: readonly string[]): Promise<Member[]> {
    if (businessIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('members')
      .selectAll()
      .where('business_id', 'in', [...businessIds])
      .execute();
    return rows.map(toMember);
  }

  /** Insert or update by id. Never an upsert: a duplicate email must fail, not overwrite. */
  async save(member: Member): Promise<void> {
    const s = member.toSnapshot();
    const values = {
      email: s.email,
      name: s.name,
      password_hash: s.passwordHash,
      is_staff: s.isStaff,
      email_verified_at: s.emailVerifiedAt,
      totp_secret_enc: s.totpSecretEnc === null ? null : Buffer.from(s.totpSecretEnc, 'utf8'),
      totp_enabled_at: s.totpEnabledAt,
    };
    const exists = await this.db
      .selectFrom('members')
      .select('id')
      .where('id', '=', s.id)
      .executeTakeFirst();
    try {
      if (exists) {
        await this.db.updateTable('members').set(values).where('id', '=', s.id).execute();
      } else {
        await this.db
          .insertInto('members')
          .values({
            ...values,
            id: s.id,
            business_id: s.businessId,
            role: s.role,
            created_at: s.createdAt,
          })
          .execute();
      }
    } catch (err) {
      if (isDuplicateKey(err)) throw identityErrors.emailTaken();
      throw err;
    }
  }
}

export class KyselySessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Session | null> {
    const r = await this.db
      .selectFrom('sessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) return null;
    return Session.restore({
      id: r.id,
      memberId: r.member_id,
      actingAsBusinessId: r.acting_as_business_id,
      twoFactorPassed: r.two_factor_passed === 1,
      twoFactorFailures: r.two_factor_failures,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
    });
  }

  async save(session: Session): Promise<void> {
    const s = session.toSnapshot();
    const changes = {
      acting_as_business_id: s.actingAsBusinessId,
      two_factor_passed: s.twoFactorPassed,
      two_factor_failures: s.twoFactorFailures,
      last_seen_at: s.lastSeenAt,
      expires_at: s.expiresAt,
    };
    await this.db
      .insertInto('sessions')
      .values({ ...changes, id: s.id, member_id: s.memberId, created_at: s.createdAt })
      .onDuplicateKeyUpdate(changes)
      .execute();
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('sessions').where('id', '=', id).execute();
  }

  async deleteAllForMember(memberId: string, exceptId?: string): Promise<void> {
    let query = this.db.deleteFrom('sessions').where('member_id', '=', memberId);
    if (exceptId) query = query.where('id', '!=', exceptId);
    await query.execute();
  }
}

export class KyselyEmailTokenRepository implements EmailTokenRepository {
  constructor(private readonly db: Db) {}

  async findByHash(tokenHash: string): Promise<EmailToken | null> {
    const r = await this.db
      .selectFrom('email_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
    if (!r) return null;
    return EmailToken.restore({
      id: r.id,
      memberId: r.member_id,
      purpose: r.purpose,
      tokenHash: r.token_hash,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      usedAt: r.used_at,
    });
  }

  async save(token: EmailToken): Promise<void> {
    const s = token.toSnapshot();
    const exists = await this.db
      .selectFrom('email_tokens')
      .select('id')
      .where('id', '=', s.id)
      .executeTakeFirst();
    if (exists) {
      await this.db
        .updateTable('email_tokens')
        .set({ used_at: s.usedAt })
        .where('id', '=', s.id)
        .execute();
      return;
    }
    await this.db
      .insertInto('email_tokens')
      .values({
        id: s.id,
        member_id: s.memberId,
        purpose: s.purpose,
        token_hash: s.tokenHash,
        created_at: s.createdAt,
        expires_at: s.expiresAt,
        used_at: s.usedAt,
      })
      .execute();
  }

  async latestCreatedAt(memberId: string, purpose: EmailTokenPurpose): Promise<Date | null> {
    const r = await this.db
      .selectFrom('email_tokens')
      .select('created_at')
      .where('member_id', '=', memberId)
      .where('purpose', '=', purpose)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return r?.created_at ?? null;
  }

  async countSince(memberId: string, purpose: EmailTokenPurpose, since: Date): Promise<number> {
    const r = await this.db
      .selectFrom('email_tokens')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('member_id', '=', memberId)
      .where('purpose', '=', purpose)
      .where('created_at', '>', since)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async markAllUsed(memberId: string, purpose: EmailTokenPurpose, at: Date): Promise<void> {
    await this.db
      .updateTable('email_tokens')
      .set({ used_at: at })
      .where('member_id', '=', memberId)
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .execute();
  }
}

export class KyselyLoginAttemptRepository implements LoginAttemptRepository {
  constructor(
    private readonly db: Db,
    private readonly newId: () => string,
  ) {}

  async record(a: LoginAttempt): Promise<void> {
    await this.db
      .insertInto('login_attempts')
      .values({ id: this.newId(), email: a.email, ip: a.ip, success: a.success, created_at: a.at })
      .execute();
  }

  private async count(
    column: 'email' | 'ip',
    value: string,
    since: Date,
    only: { failures: true } | { signups: true },
  ): Promise<number> {
    let q = this.db
      .selectFrom('login_attempts')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where(column, '=', value)
      .where('created_at', '>', since);
    q = 'failures' in only ? q.where('success', '=', 0) : q.where('email', '=', SIGNUP_MARKER);
    const r = await q.executeTakeFirstOrThrow();
    return Number(r.n);
  }

  countFailuresForEmail(email: string, since: Date): Promise<number> {
    return this.count('email', email, since, { failures: true });
  }

  countFailuresForIp(ip: string, since: Date): Promise<number> {
    return this.count('ip', ip, since, { failures: true });
  }

  recordSignup(ip: string, at: Date): Promise<void> {
    return this.record({ email: SIGNUP_MARKER, ip, success: true, at });
  }

  countSignupsForIp(ip: string, since: Date): Promise<number> {
    return this.count('ip', ip, since, { signups: true });
  }
}

// Read model -------------------------------------------------------------------------------------

interface Cursor {
  k: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    return typeof c.k === 'string' && typeof c.id === 'string' ? { k: c.k, id: c.id } : null;
  } catch {
    return null;
  }
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Businesses joined to their Owner (same module), keyset-paginated, newest first. */
export class KyselyBusinessDirectory implements BusinessDirectory {
  constructor(private readonly db: Db) {}

  async list(
    query: BusinessListQuery,
  ): Promise<{ items: BusinessListItem[]; nextCursor: string | null }> {
    const sortKey =
      query.sort === 'lastActive'
        ? sql<Date>`COALESCE(b.last_active_at, b.created_at)`
        : sql<Date>`b.created_at`;
    let q = this.db
      .selectFrom('businesses as b')
      .innerJoin('members as m', 'm.business_id', 'b.id')
      .select([
        'b.id',
        'b.name',
        'b.internal',
        'b.created_at',
        'b.last_active_at',
        'm.email',
        'm.name as owner_name',
        'm.email_verified_at',
      ])
      .select(sortKey.as('sort_key'));
    const search = query.q?.trim();
    if (search) {
      const pattern = likePattern(search.toLowerCase());
      q = q.where((eb) => eb.or([eb('b.name', 'like', pattern), eb('m.email', 'like', pattern)]));
    }
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      const k = new Date(cursor.k);
      q = q.where(
        (eb) =>
          sql<boolean>`(${sortKey} < ${k} OR (${sortKey} = ${k} AND ${eb.ref('b.id')} < ${cursor.id}))`,
      );
    }
    const rows = await q
      .orderBy(sortKey, 'desc')
      .orderBy('b.id', 'desc')
      .limit(query.limit + 1)
      .execute();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        id: r.id,
        name: r.name,
        internal: r.internal === 1,
        ownerEmail: r.email,
        ownerName: r.owner_name,
        verified: r.email_verified_at !== null,
        signedUpAt: r.created_at,
        lastActiveAt: r.last_active_at,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ k: new Date(last.sort_key).toISOString(), id: last.id })
          : null,
    };
  }
}

/** Repositories on a connection or a transaction (events are bound by the Unit of Work). */
export function kyselyIdentityRepos(db: Db, newId: () => string): Omit<IdentityRepos, 'events'> {
  return {
    businesses: new KyselyBusinessRepository(db),
    members: new KyselyMemberRepository(db),
    sessions: new KyselySessionRepository(db),
    emailTokens: new KyselyEmailTokenRepository(db),
    loginAttempts: new KyselyLoginAttemptRepository(db, newId),
  };
}
