import { createIdentityUseCases } from '../application/use-cases.js';
import type { SignedIn } from '../application/session-context.js';
import { FakeTotp, fakeIdentity, type FakeIdentity } from './fakes.js';

export const PASSWORD = 'correct horse battery';

let n = 0;
/** A unique sign-up command (each with its own IP, so the sign-up limit never interferes). */
export function signupDetails(overrides: Partial<{ email: string; businessName: string }> = {}) {
  n += 1;
  return {
    businessName: overrides.businessName ?? `Business ${n}`,
    name: `Owner ${n}`,
    email: overrides.email ?? `owner${n}@example.com`,
    password: PASSWORD,
    ip: `10.0.0.${n % 250}`,
  };
}

export function identityWorld(services: FakeIdentity = fakeIdentity()) {
  const useCases = createIdentityUseCases(services);
  return {
    s: services,
    ...useCases,
    /** Signs up a new Owner. */
    async owner(overrides: Parameters<typeof signupDetails>[0] = {}): Promise<SignedIn> {
      return useCases.signUp.execute(signupDetails(overrides));
    },
    /** Signs up a Member, makes them Staff, and passes two-factor: a full Staff session. */
    async staff(): Promise<SignedIn> {
      const details = signupDetails();
      await useCases.signUp.execute(details);
      await useCases.runStaffCommand.execute({ command: 'grant', email: details.email });
      const half = await useCases.logIn.execute(details);
      await useCases.setUpTwoFactor.execute({ token: half.sessionToken });
      const me = await useCases.verifyTwoFactor.execute({
        token: half.sessionToken,
        code: FakeTotp.validCode,
        ip: '1.1.1.1',
      });
      return { me, sessionToken: half.sessionToken };
    },
    async actorOf(token: string) {
      const actor = await useCases.resolveActor.execute({ token, path: '/api/plans' });
      if (!actor) throw new Error('expected a signed-in actor');
      return actor;
    },
  };
}
