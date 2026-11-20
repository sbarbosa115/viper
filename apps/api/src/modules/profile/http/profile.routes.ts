import { routePath } from '@app/contracts/common';
import {
  createProduct,
  deleteProduct,
  getProfile,
  updateProduct,
  updateProfile,
} from '@app/contracts/profile';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Actor } from '../../../shared/domain/actor.js';
import { UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { ProfileService } from '../application/profile-use-cases.js';

function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new UnauthenticatedError('Sign in required');
  return req.actor;
}

/** Profile endpoints (PRD section 7, FR-14 and FR-15), registered under /api. */
export function profileRoutes(app: FastifyInstance, deps: { profile: ProfileService }): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };
  const { profile } = deps;

  api.get(
    routePath(getProfile),
    { ...auth, schema: { tags: ['profile'], response: { 200: getProfile.response } } },
    (req) => profile.view(actorOf(req)),
  );

  api.put(
    routePath(updateProfile),
    {
      ...auth,
      schema: {
        tags: ['profile'],
        body: updateProfile.body,
        response: { 200: updateProfile.response },
      },
    },
    (req) => profile.update(actorOf(req), req.body),
  );

  api.post(
    routePath(createProduct),
    {
      ...auth,
      schema: {
        tags: ['profile'],
        body: createProduct.body,
        response: { 201: createProduct.response },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await profile.createProduct(actorOf(req), req.body)),
  );

  api.put(
    routePath(updateProduct),
    {
      ...auth,
      schema: {
        tags: ['profile'],
        params: updateProduct.params,
        body: updateProduct.body,
        response: { 200: updateProduct.response },
      },
    },
    (req) => profile.updateProduct(actorOf(req), req.params.id, req.body),
  );

  api.delete(
    routePath(deleteProduct),
    { ...auth, schema: { tags: ['profile'], params: deleteProduct.params } },
    async (req, reply) => {
      await profile.deleteProduct(actorOf(req), req.params.id);
      return reply.status(204).send();
    },
  );
}
