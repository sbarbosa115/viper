import { routePath } from '@app/contracts/common';
import {
  changePassword,
  confirmPasswordReset,
  getMe,
  login,
  logout,
  requestPasswordReset,
  resendVerificationEmail,
  signup,
  startActingAs,
  stopActingAs,
  twoFactorSetup,
  twoFactorVerify,
  verifyEmail,
} from '@app/contracts/identity';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { SignedIn } from '../application/session-context.js';
import type { IdentityUseCases } from '../application/use-cases.js';
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
  type CookieOptions,
} from './session-cookie.js';

/** PRD section 7, Identity: every route is declared by its contract in @app/contracts/identity. */
export function identityRoutes(
  app: FastifyInstance,
  uc: IdentityUseCases,
  cookies: CookieOptions,
): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const signIn = (reply: FastifyReply, result: SignedIn) => {
    setSessionCookie(reply, result.sessionToken, cookies);
    return result.me;
  };

  api.post(
    routePath(signup),
    { schema: { body: signup.body, response: { 201: signup.response } } },
    async (req, reply) => {
      const result = await uc.signUp.execute({ ...req.body, ip: req.ip });
      return reply.status(201).send(signIn(reply, result));
    },
  );

  api.post(
    routePath(verifyEmail),
    { schema: { body: verifyEmail.body, response: { 200: verifyEmail.response } } },
    (req) => uc.verifyEmail.execute(req.body),
  );

  api.post(
    routePath(resendVerificationEmail),
    { preHandler: app.authenticate },
    async (req, reply) => {
      if (!req.actor) throw new UnauthenticatedError('Sign in required');
      await uc.resendVerificationEmail.execute({ actor: req.actor });
      return reply.status(202).send();
    },
  );

  api.post(
    routePath(login),
    { schema: { body: login.body, response: { 200: login.response } } },
    async (req, reply) => signIn(reply, await uc.logIn.execute({ ...req.body, ip: req.ip })),
  );

  api.post(
    routePath(twoFactorSetup),
    { schema: { response: { 200: twoFactorSetup.response } } },
    (req) => uc.setUpTwoFactor.execute({ token: readSessionToken(req) }),
  );

  api.post(
    routePath(twoFactorVerify),
    { schema: { body: twoFactorVerify.body, response: { 200: twoFactorVerify.response } } },
    (req) => uc.verifyTwoFactor.execute({ token: readSessionToken(req), code: req.body.code }),
  );

  api.post(routePath(logout), async (req, reply) => {
    const ended = await uc.logOut.execute({ token: readSessionToken(req) });
    clearSessionCookie(reply, cookies);
    if (!ended) throw new UnauthenticatedError('Sign in required');
    return reply.status(204).send();
  });

  api.get(
    routePath(getMe),
    { schema: { response: { 200: getMe.response } } },
    async (req, reply) => {
      const token = readSessionToken(req);
      const me = await uc.getMe.execute({ token });
      // The SPA asks for `me` on every load: re-setting the cookie slides its browser expiry.
      if (token) setSessionCookie(reply, token, cookies);
      return me;
    },
  );

  api.post(
    routePath(requestPasswordReset),
    { schema: { body: requestPasswordReset.body } },
    async (req, reply) => {
      await uc.requestPasswordReset.execute(req.body);
      return reply.status(202).send();
    },
  );

  api.post(
    routePath(confirmPasswordReset),
    {
      schema: {
        body: confirmPasswordReset.body,
        response: { 200: confirmPasswordReset.response },
      },
    },
    async (req, reply) => signIn(reply, await uc.confirmPasswordReset.execute(req.body)),
  );

  api.put(
    routePath(changePassword),
    { preHandler: app.authenticate, schema: { body: changePassword.body } },
    async (req, reply) => {
      if (!req.actor) throw new UnauthenticatedError('Sign in required');
      await uc.changePassword.execute({
        actor: req.actor,
        sessionToken: readSessionToken(req),
        ...req.body,
      });
      return reply.status(204).send();
    },
  );

  api.post(
    routePath(startActingAs),
    {
      preHandler: app.authenticate,
      schema: { body: startActingAs.body, response: { 200: startActingAs.response } },
    },
    (req) =>
      uc.startActingAs.execute({
        actor: req.actor,
        token: readSessionToken(req),
        businessId: req.body.businessId,
      }),
  );

  api.delete(
    routePath(stopActingAs),
    { preHandler: app.authenticate, schema: { response: { 200: stopActingAs.response } } },
    (req) => uc.stopActingAs.execute({ actor: req.actor, token: readSessionToken(req) }),
  );
}
