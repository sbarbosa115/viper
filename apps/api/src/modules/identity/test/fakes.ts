import { createHash } from 'node:crypto';
import { RecordingAnalyticsTracker } from '../../../shared/infrastructure/analytics/db-analytics-tracker.js';
import { InMemoryEmailSender } from '../../../shared/infrastructure/email/in-memory-email-sender.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import type {
  AuditRecorder,
  BusinessDirectory,
  BusinessListItem,
  BusinessWithOwner,
  BusinessRepository,
  EmailTokenRepository,
  IdentityEvents,
  IdentityLogger,
  IdentityRepos,
  IdentityServices,
  IdentityUnitOfWork,
  LoginAttempt,
  LoginAttemptRepository,
  MemberRepository,
  PasswordHasher,
  SecretCipher,
  SessionRepository,
  TokenService,
  TotpService,
} from '../application/ports.js';
import { Business, type BusinessSnapshot } from '../domain/business.js';
import { EmailToken, type EmailTokenSnapshot } from '../domain/email-token.js';
import { identityErrors } from '../domain/errors.js';
import { Member, type MemberSnapshot } from '../domain/member.js';
import { Session, type SessionSnapshot } from '../domain/session.js';
import { SIGNUP_MARKER } from '../infrastructure/markers.js';

/** The tables, in memory. Repositories store cloned snapshots, so unsaved changes are lost. */
export class InMemoryIdentityStore {
  businesses = new Map<string, BusinessSnapshot>();
  members = new Map<string, MemberSnapshot>();
  sessions = new Map<string, SessionSnapshot>();
  tokens = new Map<string, EmailTokenSnapshot>();
  attempts: LoginAttempt[] = [];
  /** Events published by committed units of work. */
  events: { type: keyof IdentityEvents; payload: unknown }[] = [];

  snapshot() {
    return structuredClone({
      businesses: this.businesses,
      members: this.members,
      sessions: this.sessions,
      tokens: this.tokens,
      attempts: this.attempts,
    });
  }

  restoreFrom(s: ReturnType<InMemoryIdentityStore['snapshot']>): void {
    Object.assign(this, s);
  }
}

class InMemoryBusinesses implements BusinessRepository {
  constructor(private readonly db: InMemoryIdentityStore) {}
  findById(id: string) {
    const s = this.db.businesses.get(id);
    return Promise.resolve(s ? Business.restore(structuredClone(s)) : null);
  }
  async findByIds(ids: readonly string[]) {
    const found = await Promise.all(ids.map((id) => this.findById(id)));
    return found.filter((b): b is Business => b !== null);
  }
  save(business: Business) {
    this.db.businesses.set(business.id, structuredClone(business.toSnapshot()));
    return Promise.resolve();
  }
  touchActivity(id: string, at: Date) {
    const s = this.db.businesses.get(id);
    if (s) s.lastActiveAt = at;
    return Promise.resolve();
  }
}

class InMemoryMembers implements MemberRepository {
  constructor(private readonly db: InMemoryIdentityStore) {}
  private restore(s: MemberSnapshot | undefined) {
    return s ? Member.restore(structuredClone(s)) : null;
  }
  findById(id: string) {
    return Promise.resolve(this.restore(this.db.members.get(id)));
  }
  findByEmail(email: string) {
    return Promise.resolve(
      this.restore([...this.db.members.values()].find((m) => m.email === email)),
    );
  }
  findOwnerOf(businessId: string) {
    return Promise.resolve(
      this.restore([...this.db.members.values()].find((m) => m.businessId === businessId)),
    );
  }
  findOwnersOf(businessIds: readonly string[]) {
    return Promise.resolve(
      [...this.db.members.values()]
        .filter((m) => businessIds.includes(m.businessId))
        .map((m) => Member.restore(structuredClone(m))),
    );
  }
  save(member: Member) {
    const s = member.toSnapshot();
    const clash = [...this.db.members.values()].find((m) => m.email === s.email && m.id !== s.id);
    if (clash) return Promise.reject(identityErrors.emailTaken());
    this.db.members.set(s.id, structuredClone(s));
    return Promise.resolve();
  }
}

class InMemorySessions implements SessionRepository {
  constructor(private readonly db: InMemoryIdentityStore) {}
  findById(id: string) {
    const s = this.db.sessions.get(id);
    return Promise.resolve(s ? Session.restore(structuredClone(s)) : null);
  }
  save(session: Session) {
    this.db.sessions.set(session.id, structuredClone(session.toSnapshot()));
    return Promise.resolve();
  }
  delete(id: string) {
    this.db.sessions.delete(id);
    return Promise.resolve();
  }
  deleteAllForMember(memberId: string, exceptId?: string) {
    for (const [id, s] of this.db.sessions) {
      if (s.memberId === memberId && id !== exceptId) this.db.sessions.delete(id);
    }
    return Promise.resolve();
  }
}

class InMemoryEmailTokens implements EmailTokenRepository {
  constructor(private readonly db: InMemoryIdentityStore) {}
  private of(memberId: string, purpose: string) {
    return [...this.db.tokens.values()].filter(
      (t) => t.memberId === memberId && t.purpose === purpose,
    );
  }
  findByHash(tokenHash: string) {
    const s = [...this.db.tokens.values()].find((t) => t.tokenHash === tokenHash);
    return Promise.resolve(s ? EmailToken.restore(structuredClone(s)) : null);
  }
  save(token: EmailToken) {
    this.db.tokens.set(token.id, structuredClone(token.toSnapshot()));
    return Promise.resolve();
  }
  latestCreatedAt(memberId: string, purpose: 'verify' | 'reset') {
    const times = this.of(memberId, purpose).map((t) => t.createdAt.getTime());
    return Promise.resolve(times.length ? new Date(Math.max(...times)) : null);
  }
  countSince(memberId: string, purpose: 'verify' | 'reset', since: Date) {
    return Promise.resolve(this.of(memberId, purpose).filter((t) => t.createdAt > since).length);
  }
  markAllUsed(memberId: string, purpose: 'verify' | 'reset', at: Date) {
    for (const t of this.of(memberId, purpose)) t.usedAt ??= at;
    return Promise.resolve();
  }
}

class InMemoryLoginAttempts implements LoginAttemptRepository {
  constructor(private readonly db: InMemoryIdentityStore) {}
  record(attempt: LoginAttempt) {
    this.db.attempts.push({ ...attempt });
    return Promise.resolve();
  }
  private count(match: (a: LoginAttempt) => boolean, since: Date) {
    return Promise.resolve(this.db.attempts.filter((a) => a.at > since && match(a)).length);
  }
  countFailuresForEmail(email: string, since: Date) {
    return this.count((a) => a.email === email && !a.success, since);
  }
  countFailuresForIp(ip: string, since: Date) {
    return this.count((a) => a.ip === ip && !a.success, since);
  }
  recordSignup(ip: string, at: Date) {
    return this.record({ email: SIGNUP_MARKER, ip, success: true, at });
  }
  countSignupsForIp(ip: string, since: Date) {
    return this.count((a) => a.ip === ip && a.email === SIGNUP_MARKER, since);
  }
}

class InMemoryDirectory implements BusinessDirectory {
  constructor(private readonly db: InMemoryIdentityStore) {}
  list(query: { q?: string; sort: 'signedUp' | 'lastActive'; cursor?: string; limit: number }) {
    const owners = [...this.db.members.values()];
    const key = (i: BusinessListItem) =>
      (query.sort === 'lastActive' ? (i.lastActiveAt ?? i.signedUpAt) : i.signedUpAt).getTime();
    const q = query.q?.toLowerCase();
    const items = [...this.db.businesses.values()]
      .flatMap((b): BusinessListItem[] => {
        const o = owners.find((m) => m.businessId === b.id);
        if (!o) return [];
        return [
          {
            id: b.id,
            name: b.name,
            internal: b.internal,
            ownerEmail: o.email,
            ownerName: o.name,
            verified: o.emailVerifiedAt !== null,
            signedUpAt: b.createdAt,
            lastActiveAt: b.lastActiveAt,
          },
        ];
      })
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.ownerEmail.includes(q))
      .sort((a, b) => key(b) - key(a) || b.id.localeCompare(a.id));
    const start = query.cursor ? items.findIndex((i) => i.id === query.cursor) + 1 : 0;
    const page = items.slice(start, start + query.limit);
    const more = start + query.limit < items.length;
    return Promise.resolve({ items: page, nextCursor: more ? (page.at(-1)?.id ?? null) : null });
  }
  all() {
    const owners = [...this.db.members.values()].filter((m) => m.role === 'owner');
    return Promise.resolve(
      [...this.db.businesses.values()].flatMap((b): BusinessWithOwner[] => {
        const o = owners.find((m) => m.businessId === b.id);
        if (!o) return [];
        return [
          {
            id: b.id,
            name: b.name,
            internal: b.internal,
            ownerEmail: o.email,
            ownerIsStaff: o.isStaff,
            signedUpAt: b.createdAt,
            verifiedAt: o.emailVerifiedAt,
          },
        ];
      }),
    );
  }
}

export function inMemoryRepos(db: InMemoryIdentityStore): Omit<IdentityRepos, 'events'> {
  return {
    businesses: new InMemoryBusinesses(db),
    members: new InMemoryMembers(db),
    sessions: new InMemorySessions(db),
    emailTokens: new InMemoryEmailTokens(db),
    loginAttempts: new InMemoryLoginAttempts(db),
  };
}

/** Runs the work on the in-memory store; a thrown error rolls the store back like a transaction. */
export class InMemoryIdentityUnitOfWork implements IdentityUnitOfWork {
  constructor(private readonly db: InMemoryIdentityStore) {}

  async run<T>(fn: (repos: IdentityRepos) => Promise<T>): Promise<T> {
    const before = this.db.snapshot();
    const pending: InMemoryIdentityStore['events'] = [];
    try {
      const result = await fn({
        ...inMemoryRepos(this.db),
        events: {
          publish: (type, payload) => {
            pending.push({ type, payload });
            return Promise.resolve();
          },
        },
      });
      this.db.events.push(...pending);
      return result;
    } catch (err) {
      this.db.restoreFrom(before);
      throw err;
    }
  }
}

/** Fast, readable stand-in for bcrypt. */
export class FakePasswordHasher implements PasswordHasher {
  hash(plain: string) {
    return Promise.resolve(`hashed:${plain}`);
  }
  verify(plain: string, hash: string) {
    return Promise.resolve(hash === `hashed:${plain}`);
  }
}

/** Predictable tokens (`token-1`, `token-2`…) with a real sha-256. */
export class SequentialTokens implements TokenService {
  private n = 0;
  readonly issued: string[] = [];
  generate() {
    this.n += 1;
    const token = `token-${this.n}`;
    this.issued.push(token);
    return token;
  }
  hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}

/** Accepts only `FakeTotp.validCode`; the real otplib adapter has its own test. */
export class FakeTotp implements TotpService {
  static readonly validCode = '123456';
  generateSecret() {
    return 'NEWSECRETNEWSECRETNEWSECRET23456';
  }
  verify(_secret: string, code: string) {
    return Promise.resolve(code === FakeTotp.validCode);
  }
  otpauthUrl(secret: string, accountName: string) {
    return `otpauth://totp/Llyner%20Leads:${encodeURIComponent(accountName)}?secret=${secret}`;
  }
  qrSvg(url: string) {
    return Promise.resolve(`<svg data-url="${url}"></svg>`);
  }
}

export class FakeCipher implements SecretCipher {
  encrypt(plain: string) {
    return `enc:${plain}`;
  }
  decrypt(cipher: string) {
    return cipher.replace(/^enc:/, '');
  }
}

export class RecordingAudit implements AuditRecorder {
  readonly entries: Parameters<AuditRecorder['record']>[0][] = [];
  record(entry: Parameters<AuditRecorder['record']>[0]) {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

export class RecordingLogger implements IdentityLogger {
  readonly warnings: string[] = [];
  warn(_obj: Record<string, unknown>, msg: string) {
    this.warnings.push(msg);
  }
}

export type FakeIdentity = IdentityServices & {
  store: InMemoryIdentityStore;
  clock: FixedClock;
  tokens: SequentialTokens;
  audit: RecordingAudit;
  analytics: RecordingAnalyticsTracker;
  email: InMemoryEmailSender;
  logger: RecordingLogger;
};

export const testNow = new Date('2026-11-19T10:00:00.000Z');

/** Identity services on in-memory fakes, with a fixed clock. */
export function fakeIdentity(overrides: Partial<IdentityServices> = {}): FakeIdentity {
  const store = new InMemoryIdentityStore();
  return {
    store,
    uow: new InMemoryIdentityUnitOfWork(store),
    repos: inMemoryRepos(store),
    directory: new InMemoryDirectory(store),
    clock: new FixedClock(testNow),
    ids: new SequentialIdGenerator(),
    passwords: new FakePasswordHasher(),
    tokens: new SequentialTokens(),
    totp: new FakeTotp(),
    cipher: new FakeCipher(),
    audit: new RecordingAudit(),
    analytics: new RecordingAnalyticsTracker(),
    email: new InMemoryEmailSender(),
    logger: new RecordingLogger(),
    appUrl: 'http://localhost:5173',
    ...overrides,
  } as FakeIdentity;
}
