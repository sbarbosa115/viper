import { EmailAddress } from '../../../shared/domain/email-address.js';
import { ConflictError, ValidationError } from '../../../shared/domain/errors.js';

export interface MemberSnapshot {
  id: string;
  businessId: string;
  /** Lowercased. */
  email: string;
  name: string;
  passwordHash: string;
  /** `member` exists only through the seed until team invites ship (prd-support v0.2). */
  role: 'owner' | 'member';
  isStaff: boolean;
  emailVerifiedAt: Date | null;
  /** The TOTP secret, encrypted by the SecretCipher port (ADR 0012). */
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  createdAt: Date;
}

/** A Member's name: 1 to 80 characters after trimming (FR-1). */
export function memberName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > 80) {
    throw new ValidationError('Name must be 1 to 80 characters', {
      name: 'Must be 1 to 80 characters',
    });
  }
  return name;
}

/** An email of at most 254 characters, lowercased (FR-1). */
export function memberEmail(raw: string): string {
  const email = EmailAddress.create(raw).value;
  if (email.length > 254) {
    throw new ValidationError('Email is too long', { email: 'At most 254 characters' });
  }
  return email;
}

/** A person who can sign in to a Business. The first version has Owners only. */
export class Member {
  private constructor(private state: MemberSnapshot) {}

  /** The Owner who creates a Business at sign-up (FR-1). */
  static registerOwner(props: {
    id: string;
    businessId: string;
    email: string;
    name: string;
    passwordHash: string;
    now: Date;
  }): Member {
    return new Member({
      id: props.id,
      businessId: props.businessId,
      email: memberEmail(props.email),
      name: memberName(props.name),
      passwordHash: props.passwordHash,
      role: 'owner',
      isStaff: false,
      emailVerifiedAt: null,
      totpSecretEnc: null,
      totpEnabledAt: null,
      createdAt: props.now,
    });
  }

  static restore(snapshot: MemberSnapshot): Member {
    return new Member({ ...snapshot });
  }

  get id(): string {
    return this.state.id;
  }
  get businessId(): string {
    return this.state.businessId;
  }
  get email(): string {
    return this.state.email;
  }
  get name(): string {
    return this.state.name;
  }
  get passwordHash(): string {
    return this.state.passwordHash;
  }
  get isStaff(): boolean {
    return this.state.isStaff;
  }
  get role(): 'owner' | 'member' {
    return this.state.role;
  }
  get emailVerified(): boolean {
    return this.state.emailVerifiedAt !== null;
  }
  get twoFactorSetUp(): boolean {
    return this.state.totpEnabledAt !== null;
  }
  /** The encrypted secret being set up or in use, if any. */
  get totpSecretEnc(): string | null {
    return this.state.totpSecretEnc;
  }

  /** Returns false when the email was already verified (no second trial grant, FR-2). */
  verifyEmail(now: Date): boolean {
    if (this.state.emailVerifiedAt) return false;
    this.state.emailVerifiedAt = now;
    return true;
  }

  changePassword(passwordHash: string): void {
    this.state.passwordHash = passwordHash;
  }

  grantStaff(): void {
    this.state.isStaff = true;
  }

  revokeStaff(): void {
    this.state.isStaff = false;
  }

  /** First Staff login: store a new secret until a code confirms it (FR-5). */
  beginTwoFactorSetup(totpSecretEnc: string): void {
    if (!this.state.isStaff) throw new ConflictError('Two-factor is only for Staff');
    if (this.twoFactorSetUp) throw new ConflictError('Two-factor is already set up');
    this.state.totpSecretEnc = totpSecretEnc;
  }

  /** A correct code during setup turns two-factor on. */
  confirmTwoFactorSetup(now: Date): void {
    if (!this.state.totpSecretEnc) throw new ConflictError('Set up two-factor first');
    this.state.totpEnabledAt ??= now;
  }

  /** `staff:reset-2fa`: the Member sets up an authenticator again at the next login. */
  resetTwoFactor(): void {
    this.state.totpSecretEnc = null;
    this.state.totpEnabledAt = null;
  }

  /** Seed only: a known secret, already confirmed. */
  enableTwoFactorWith(totpSecretEnc: string, now: Date): void {
    this.state.totpSecretEnc = totpSecretEnc;
    this.state.totpEnabledAt = now;
  }

  toSnapshot(): MemberSnapshot {
    return { ...this.state };
  }
}
