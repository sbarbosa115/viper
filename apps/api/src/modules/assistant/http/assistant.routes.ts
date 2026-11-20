import { getWelcomeConversation, sendMessage } from '@app/contracts/assistant';
import { routePath } from '@app/contracts/common';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Actor } from '../../../shared/domain/actor.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { WelcomeChat } from '../application/welcome-chat.js';

function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new UnauthenticatedError('Sign in required');
  return req.actor;
}

/** Assistant endpoints (PRD section 7, FR-14), registered under /api. */
export function assistantRoutes(app: FastifyInstance, deps: { chat: WelcomeChat }): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  api.get(
    routePath(getWelcomeConversation),
    {
      ...auth,
      schema: { tags: ['assistant'], response: { 200: getWelcomeConversation.response } },
    },
    (req) => deps.chat.getWelcome(actorOf(req)),
  );

  api.post(
    routePath(sendMessage),
    {
      ...auth,
      schema: {
        tags: ['assistant'],
        params: sendMessage.params,
        body: sendMessage.body,
        response: { 200: sendMessage.response },
      },
    },
    (req) => deps.chat.send(actorOf(req), req.params.id, req.body),
  );
}
