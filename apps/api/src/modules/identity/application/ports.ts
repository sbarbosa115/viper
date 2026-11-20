import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { EmailSender } from '../../../shared/application/email-sender.js';
import type { EventPublisher } from '../../../shared/application/event-publisher.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import type { Business } from '../domain/business.js';
import type { EmailToken, EmailTokenPurpose } from '../domain/email-token.js';
import type { Member } from '../domain/member.js';
import type { Session } from '../domain/session.js';

// Repositories ------------------------------------------------------------------------------------

export interface BusinessRepository {
  findById(id: string): Promise<Business | null>;
  findByIds(ids: readonly string[]): Promise<Business[]>;
  save(business: Business): Promise<void>;
  /** `last_active_at` for reporting, written when a session is touched. */
  touchActivity(id: string, at: Date): Promise<void>;
}

export interface MemberRepository {
  findById(id: string): Promise<Member | null>;
  /** `email` is already lowercased. */
  findByEmail(email: string): Promise<Member | null>;
  findOwnerOf(businessId: string): Promise<Member | null>;
  findOwnersOf(businessIds: readonly string[]): Promise<Member[]>;
  /** Inserting a second Member with the same email throws EMAIL_TAKEN. */
  save(member: Member): Promise<void>;
}

export interface SessionRepository {
  findById(id: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  /** Signs the Member out everywhere, optionally keeping one session. */
  deleteAllForMember(memberId: string, exceptId?: string): Promise<void>;
}

export interface EmailTokenRepository {
  findByHash(tokenHash: string): Promise<EmailToken | null>;
  save(token: EmailToken): Promise<void>;
  latestCreatedAt(memberId: string, purpose: EmailTokenPurpose): Promise<Date | null>;
  countSince(memberId: string, purpose: EmailTokenPurpose, since: Date): Promise<number>;
  /** Single use: a used reset link voids the Member's other reset links. */
  markAllUsed(memberId: string, purpose: EmailTokenPurpose, at: Date): Promise<void>;
}

export interface LoginAttempt {
  email: string;
  ip: string;
  success: boolean;
  at: Date;
}

/** `login_attempts` (FR-3), also counting sign-ups per IP (FR-1) under a marker email. */
export interface LoginAttemptRepository {
  record(attempt: LoginAttempt): Promise<void>;
  countFailuresForEmail(email: string, since: Date): Promise<number>;
  countFailuresForIp(ip: string, since: Date): Promise<number>;
  recordSignup(ip: string, at: Date): Promise<void>;
  countSignupsForIp(ip: string, since: Date): Promise<number>;
}

export interface BusinessListItem {
  id: string;
  name: string;
  internal: boolean;
  ownerEmail: string;
  ownerName: string;
  verified: boolean;
  signedUpAt: Date;
  lastActiveAt: Date | null;
}

export interface BusinessListQuery {
  /** Matches the Business name or the Owner email. */
  q?: string;
  sort: 'signedUp' | 'lastActive';
  cursor?: string;
  limit: number;
}

/** A Business with its Owner, for reporting's Staff dashboard (FR-30). */
export interface BusinessWithOwner {
  id: string;
  name: string;
  internal: boolean;
  ownerEmail: string;
  /** The Owner is Staff: the Staff's own Business. */
  ownerIsStaff: boolean;
  signedUpAt: Date;
  /** When the Owner verified their email; null when not yet. */
  verifiedAt: Date | null;
}

/** Read model for the Staff customer list (FR-31): Businesses with their Owner, newest first. */
export interface BusinessDirectory {
  list(query: BusinessListQuery): Promise<{ items: BusinessListItem[]; nextCursor: string | null }>;
  /** Every Business with its Owner, unordered (fewer than a few hundred in this version). */
  all(): Promise<BusinessWithOwner[]>;
}

/** The OutboxEvents map lives in shared infrastructure; identity publishes only this one. */
export interface IdentityEvents {
  MemberEmailVerified: { memberId: string; businessId: string };
}

export interface IdentityRepos {
  businesses: BusinessRepository;
  members: MemberRepository;
  sessions: SessionRepository;
  emailTokens: EmailTokenRepository;
  loginAttempts: LoginAttemptRepository;
  /** Bound to the transaction: published if and only if it commits. */
  events: EventPublisher<IdentityEvents>;
}

export type IdentityUnitOfWork = UnitOfWork<IdentityRepos>;

// Services ----------------------------------------------------------------------------------------

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

/** Random secrets for session and email tokens, and their sha-256 for storage. */
export interface TokenService {
  /** A new random token (URL-safe). */
  generate(): string;
  /** sha-256 hex; what the database stores. */
  hash(token: string): string;
}

export interface TotpService {
  generateSecret(): string;
  /** RFC 6238, 30 s, 6 digits, ±1 step. */
  verify(secret: string, code: string, at: Date): Promise<boolean>;
  otpauthUrl(secret: string, accountName: string): string;
  qrSvg(otpauthUrl: string): Promise<string>;
}

/** Implemented by platform's SecretBox (AES-256-GCM, ADR 0012); encrypts the TOTP secret. */
export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

/** Implemented by platform (FR-7): append-only record of Staff access and changes. */
export interface AuditRecorder {
  record(entry: {
    staffMemberId: string;
    businessId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    details: Record<string, unknown>;
  }): Promise<void>;
}

/** Minimal logger (pino-compatible) for failures that must not fail the request. */
export interface IdentityLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Everything the identity use cases need. Built once by the module (Kysely or in-memory). */
export interface IdentityServices {
  uow: IdentityUnitOfWork;
  /** Non-transactional repositories for reads (the session lookup on every request). */
  repos: Omit<IdentityRepos, 'events'>;
  directory: BusinessDirectory;
  clock: Clock;
  ids: IdGenerator;
  passwords: PasswordHasher;
  tokens: TokenService;
  totp: TotpService;
  cipher: SecretCipher;
  audit: AuditRecorder;
  analytics: AnalyticsTracker;
  email: EmailSender;
  logger: IdentityLogger;
  /** Origin of the app, e.g. `https://app.example.com`; links are `${appUrl}/app/...`. */
  appUrl: string;
}
