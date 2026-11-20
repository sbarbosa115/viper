import { sql, type Kysely } from 'kysely';

/**
 * identity: Staff two-factor brute-force and replay guards (FR-5).
 * - `totp_last_step`: the RFC 6238 time step of the last code that passed; a code for the same or
 *   an older step is refused, so a code can't be used twice in its window.
 * - `two_factor_locked_until`: 10 wrong codes per Member in an hour, across sessions, lock
 *   two-factor until this time. Wrong codes are counted in `login_attempts` (marker `#2fa:<id>`).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE members
        ADD COLUMN totp_last_step BIGINT NULL AFTER totp_enabled_at,
        ADD COLUMN two_factor_locked_until DATETIME(3) NULL AFTER totp_last_step`,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE members
        DROP COLUMN totp_last_step,
        DROP COLUMN two_factor_locked_until`,
    )
    .execute(db);
}
