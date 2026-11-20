import { NotFoundError } from '../../../shared/domain/errors.js';
import type { Member } from '../domain/member.js';
import type { IdentityServices } from './ports.js';

export type StaffCommand = 'grant' | 'revoke' | 'reset-2fa';

/**
 * Server commands (FR-5, PRD section 4): Staff status is never granted through the UI.
 * - grant: sets the Staff flag on an existing Member.
 * - revoke: clears it and deletes the Member's sessions.
 * - reset-2fa: clears the TOTP secret (lost authenticator) and deletes the sessions.
 */
export class RunStaffCommand {
  constructor(private readonly s: Pick<IdentityServices, 'uow'>) {}

  async execute(cmd: { command: StaffCommand; email: string }): Promise<string> {
    const email = cmd.email.trim().toLowerCase();
    return this.s.uow.run(async (r) => {
      const member = await r.members.findByEmail(email);
      if (!member) throw new NotFoundError(`No Member with email ${email}`, { email });
      const message = apply(cmd.command, member);
      await r.members.save(member);
      if (cmd.command !== 'grant') await r.sessions.deleteAllForMember(member.id);
      return message;
    });
  }
}

function apply(command: StaffCommand, member: Member): string {
  switch (command) {
    case 'grant':
      member.grantStaff();
      return `${member.email} is now Staff; two-factor setup starts at the next login.`;
    case 'revoke':
      member.revokeStaff();
      return `${member.email} is no longer Staff; their sessions were deleted.`;
    case 'reset-2fa':
      member.resetTwoFactor();
      return `Two-factor for ${member.email} was reset; they set it up again at the next login.`;
  }
}
