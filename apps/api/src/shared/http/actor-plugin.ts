import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Actor } from '../domain/actor.js';
import { UnauthenticatedError } from '../domain/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export type ResolveActor = (req: FastifyRequest) => Promise<Actor | null> | Actor | null;

/** Sets `req.actor` from the given resolver (the identity module's session lookup, or a test stub). */
export function registerActor(app: FastifyInstance, resolveActor: ResolveActor | undefined): void {
  app.decorateRequest('actor', null);
  app.addHook('onRequest', async (req) => {
    req.actor = resolveActor ? await resolveActor(req) : null;
  });
  app.decorate('authenticate', (req: FastifyRequest) => {
    if (!req.actor) return Promise.reject(new UnauthenticatedError('Sign in required'));
    return Promise.resolve();
  });
}
