import { StartActingAs, StopActingAs } from './acting-as.js';
import { GetMe, LogIn, LogOut } from './log-in.js';
import { ChangePassword, ConfirmPasswordReset, RequestPasswordReset } from './password.js';
import type { IdentityServices } from './ports.js';
import { ResolveActor } from './resolve-actor.js';
import { SignUp } from './sign-up.js';
import { RunStaffCommand } from './staff-commands.js';
import { SetUpTwoFactor, VerifyTwoFactor } from './two-factor.js';
import { ResendVerificationEmail, VerifyEmail } from './verify-email.js';

export function createIdentityUseCases(s: IdentityServices) {
  return {
    signUp: new SignUp(s),
    verifyEmail: new VerifyEmail(s),
    resendVerificationEmail: new ResendVerificationEmail(s),
    logIn: new LogIn(s),
    logOut: new LogOut(s),
    getMe: new GetMe(s),
    requestPasswordReset: new RequestPasswordReset(s),
    confirmPasswordReset: new ConfirmPasswordReset(s),
    changePassword: new ChangePassword(s),
    setUpTwoFactor: new SetUpTwoFactor(s),
    verifyTwoFactor: new VerifyTwoFactor(s),
    startActingAs: new StartActingAs(s),
    stopActingAs: new StopActingAs(s),
    resolveActor: new ResolveActor(s),
    runStaffCommand: new RunStaffCommand(s),
  };
}

export type IdentityUseCases = ReturnType<typeof createIdentityUseCases>;
