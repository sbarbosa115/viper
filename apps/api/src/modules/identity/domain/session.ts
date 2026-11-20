const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** ADR 0004, FR-3: 30-day sliding expiry, 14-day idle timeout, written at most once an hour. */
export const sessionPolicy = {
  ttlMs: 30 * DAY,
  idleMs: 14 * DAY,
  touchEveryMs: HOUR,
  /** Two-factor codes a half-session may try; the 5th wrong one deletes it (FR-5). */
  maxTwoFactorAttempts: 5,
} as const;

export interface SessionSnapshot {
  /** sha-256 of the token (the cookie holds the token itself). */
  id: string;
  memberId: string;
  actingAsBusinessId: string | null;
  twoFactorPassed: boolean;
  /** Two-factor codes tried on this half-session (counted atomically by the repository). */
  twoFactorFailures: number;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

/**
 * FR-5: once a half-session has tried this many codes, a wrong one deletes it; any code past it is
 * refused unchecked (concurrent guesses).
 */
export function halfSessionExhausted(attempts: number): boolean {
  return attempts >= sessionPolicy.maxTwoFactorAttempts;
}

/** A signed-in browser. Staff sessions are "half" until the two-factor code passes (FR-5). */
export class Session {
  private constructor(private state: SessionSnapshot) {}

  static start(props: { id: string; memberId: string; now: Date }): Session {
    return new Session({
      id: props.id,
      memberId: props.memberId,
      actingAsBusinessId: null,
      twoFactorPassed: false,
      twoFactorFailures: 0,
      createdAt: props.now,
      lastSeenAt: props.now,
      expiresAt: new Date(props.now.getTime() + sessionPolicy.ttlMs),
    });
  }

  static restore(snapshot: SessionSnapshot): Session {
    return new Session({ ...snapshot });
  }

  get id(): string {
    return this.state.id;
  }
  get memberId(): string {
    return this.state.memberId;
  }
  get actingAsBusinessId(): string | null {
    return this.state.actingAsBusinessId;
  }
  get twoFactorPassed(): boolean {
    return this.state.twoFactorPassed;
  }

  isActive(now: Date): boolean {
    const t = now.getTime();
    return (
      t < this.state.expiresAt.getTime() &&
      t - this.state.lastSeenAt.getTime() < sessionPolicy.idleMs
    );
  }

  /** Slides the expiry. Returns true when the change is worth writing (at most once an hour). */
  touch(now: Date): boolean {
    if (now.getTime() - this.state.lastSeenAt.getTime() < sessionPolicy.touchEveryMs) return false;
    this.state.lastSeenAt = now;
    this.state.expiresAt = new Date(now.getTime() + sessionPolicy.ttlMs);
    return true;
  }

  passTwoFactor(): void {
    this.state.twoFactorPassed = true;
    this.state.twoFactorFailures = 0;
  }

  /** Only one Business at a time: starting another replaces the first (FR-6). */
  actAs(businessId: string): void {
    this.state.actingAsBusinessId = businessId;
  }

  stopActingAs(): void {
    this.state.actingAsBusinessId = null;
  }

  toSnapshot(): SessionSnapshot {
    return { ...this.state };
  }
}
