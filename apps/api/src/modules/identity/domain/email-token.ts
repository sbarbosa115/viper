import { identityErrors } from './errors.js';

export type EmailTokenPurpose = 'verify' | 'reset';

/** Verification links live 24 h (FR-2); reset links 1 h (FR-4). */
export const emailTokenLifetimeMs: Record<EmailTokenPurpose, number> = {
  verify: 24 * 60 * 60_000,
  reset: 60 * 60_000,
};

export interface EmailTokenSnapshot {
  id: string;
  memberId: string;
  purpose: EmailTokenPurpose;
  /** sha-256 of the token sent by email; the token itself is never stored. */
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

/** A single-use, short-lived link token for email verification or password reset. */
export class EmailToken {
  private constructor(private state: EmailTokenSnapshot) {}

  static issue(props: {
    id: string;
    memberId: string;
    purpose: EmailTokenPurpose;
    tokenHash: string;
    now: Date;
  }): EmailToken {
    return new EmailToken({
      id: props.id,
      memberId: props.memberId,
      purpose: props.purpose,
      tokenHash: props.tokenHash,
      createdAt: props.now,
      expiresAt: new Date(props.now.getTime() + emailTokenLifetimeMs[props.purpose]),
      usedAt: null,
    });
  }

  static restore(snapshot: EmailTokenSnapshot): EmailToken {
    return new EmailToken({ ...snapshot });
  }

  get id(): string {
    return this.state.id;
  }
  get memberId(): string {
    return this.state.memberId;
  }
  get purpose(): EmailTokenPurpose {
    return this.state.purpose;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }

  /** Marks the token used; an expired or used token is 410 TOKEN_EXPIRED. */
  use(now: Date): void {
    if (this.state.usedAt || now.getTime() >= this.state.expiresAt.getTime()) {
      throw identityErrors.tokenExpired();
    }
    this.state.usedAt = now;
  }

  toSnapshot(): EmailTokenSnapshot {
    return { ...this.state };
  }
}
