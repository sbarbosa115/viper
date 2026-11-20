import {
  createCheckout,
  createCreditPack,
  getCredits,
  grantCredits,
  listCreditPacks,
  listLedger,
  stripeWebhook,
  updateCreditPack,
} from '@app/contracts/billing';
import { routePath } from '@app/contracts/common';
import { errorResponse, type ErrorResponse } from '@app/contracts/errors';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Actor } from '../../../shared/domain/actor.js';
import { AppError, UnauthenticatedError } from '../../../shared/domain/errors.js';
import type { BillingApplication } from '../application/billing.js';

export interface BillingRoutesOptions {
  billing: BillingApplication;
  /** Registers POST /api/test/stripe/complete/:sessionId (e2e only, never in production). */
  testHooks: boolean;
}

function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new UnauthenticatedError('Sign in required');
  return req.actor;
}

/** Billing endpoints (PRD section 7, FR-10 to FR-13), registered under /api. */
export async function billingRoutes(
  app: FastifyInstance,
  { billing, testHooks }: BillingRoutesOptions,
): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  api.get(
    routePath(getCredits),
    { ...auth, schema: { tags: ['billing'], response: { 200: getCredits.response } } },
    (req) => billing.queries.creditsPage(actorOf(req)),
  );

  api.get(
    routePath(listLedger),
    {
      ...auth,
      schema: {
        tags: ['billing'],
        querystring: listLedger.query,
        response: { 200: listLedger.response },
      },
    },
    (req) => billing.queries.ledger(actorOf(req), req.query),
  );

  api.post(
    routePath(createCheckout),
    {
      ...auth,
      schema: {
        tags: ['billing'],
        body: createCheckout.body,
        response: { 200: createCheckout.response },
      },
    },
    (req) => billing.startCheckout.execute(req.body, actorOf(req)),
  );

  api.post(
    routePath(grantCredits),
    {
      ...auth,
      schema: {
        tags: ['billing'],
        params: grantCredits.params,
        body: grantCredits.body,
        response: { 201: grantCredits.response, 422: errorResponse },
      },
    },
    async (req, reply) => {
      try {
        const entry = await billing.adjustCredits.execute(
          { businessId: req.params.id, ...req.body },
          actorOf(req),
        );
        return await reply.status(201).send(entry);
      } catch (error) {
        // The contract documents 422 here (a Staff correction), not the run-start 402.
        if (error instanceof AppError && error.code === 'INSUFFICIENT_CREDITS') {
          const body: ErrorResponse = {
            error: { code: error.code, message: error.message, details: error.details ?? {} },
          };
          return reply.status(422).send(body);
        }
        throw error;
      }
    },
  );

  api.get(
    routePath(listCreditPacks),
    { ...auth, schema: { tags: ['billing'], response: { 200: listCreditPacks.response } } },
    async (req) => ({ items: await billing.creditPacks.list(actorOf(req)), nextCursor: null }),
  );

  api.post(
    routePath(createCreditPack),
    {
      ...auth,
      schema: {
        tags: ['billing'],
        body: createCreditPack.body,
        response: { 201: createCreditPack.response },
      },
    },
    async (req, reply) =>
      reply.status(201).send(await billing.creditPacks.create(req.body, actorOf(req))),
  );

  api.put(
    routePath(updateCreditPack),
    {
      ...auth,
      schema: {
        tags: ['billing'],
        params: updateCreditPack.params,
        body: updateCreditPack.body,
        response: { 200: updateCreditPack.response },
      },
    },
    (req) => billing.creditPacks.update(req.params.id, req.body, actorOf(req)),
  );

  // The webhook reads the raw body (signature check), so it lives in its own scope whose JSON
  // parser keeps the bytes.
  await app.register((scope, _opts, registered) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });
    scope
      .withTypeProvider<ZodTypeProvider>()
      .post(
        routePath(stripeWebhook),
        { schema: { tags: ['billing'], response: { 200: stripeWebhook.response } } },
        async (req) => {
          const signature = req.headers['stripe-signature'];
          await billing.handleStripeWebhook.execute({
            rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
            signature: Array.isArray(signature) ? signature[0] : signature,
          });
          return { received: true as const };
        },
      );
    registered();
  });

  if (testHooks) {
    api.post(
      '/test/stripe/complete/:sessionId',
      {
        schema: {
          hide: true,
          params: z.object({ sessionId: z.string().min(1).max(255) }),
          response: { 200: z.object({ fulfilled: z.boolean() }) },
        },
      },
      (req) =>
        billing.fulfilPurchase.execute({
          sessionId: req.params.sessionId,
          eventId: `evt_test_${req.params.sessionId}`,
          taxCents: 0,
        }),
    );
  }
}
