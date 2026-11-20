import type { ErrorResponse } from '@app/contracts/errors';
import type { FastifyError, FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../domain/errors.js';

const statusByCode: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RULE_VIOLATION: 422,
  BAD_REQUEST: 400,
  INVALID_SIGNATURE: 400,
  INVALID_CREDENTIALS: 401,
  INVALID_CODE: 401,
  INSUFFICIENT_CREDITS: 402,
  TWO_FACTOR_REQUIRED: 403,
  ACTING_AS_FORBIDDEN: 403,
  EMAIL_NOT_VERIFIED: 403,
  EMAIL_TAKEN: 409,
  PRODUCT_IN_USE: 409,
  RUN_IN_PROGRESS: 409,
  RUN_NOT_ACTIVE: 409,
  RUN_NOT_FAILED: 409,
  TOKEN_EXPIRED: 410,
  ADDRESS_NOT_FOUND: 422,
  PROFILE_INCOMPLETE: 422,
  TOO_MANY_REQUESTS: 429,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  PAYMENTS_UNAVAILABLE: 503,
  ASSISTANT_UNAVAILABLE: 503,
  RESEARCH_UNAVAILABLE: 503,
};

function fieldsFrom(
  validation: readonly { instancePath: string; message?: string | undefined }[],
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of validation) {
    const path = issue.instancePath.replace(/^\//, '').replaceAll('/', '.') || '_';
    fields[path] ??= issue.message ?? 'Invalid value';
  }
  return fields;
}

function body(
  code: string,
  message: string,
  fields?: Record<string, string>,
  details?: Record<string, unknown>,
): ErrorResponse {
  return {
    error: { code, message, ...(fields ? { fields } : {}), ...(details ? { details } : {}) },
  };
}

/** The only place errors become HTTP responses (PRD section 7 error shape). */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      return reply.status(404).send(body('NOT_FOUND', 'Route not found'));
    }
    return reply.status(404).type('text/plain').send('Not found');
  });

  app.setErrorHandler((error: FastifyError | AppError, req, reply) => {
    if (error instanceof AppError) {
      const override =
        'status' in error && typeof error.status === 'number' ? error.status : undefined;
      const status = override ?? statusByCode[error.code] ?? 400;
      const fields =
        error.code === 'VALIDATION_ERROR' && error.details
          ? Object.fromEntries(Object.entries(error.details).map(([k, v]) => [k, String(v)]))
          : undefined;
      const details = error.code !== 'VALIDATION_ERROR' ? error.details : undefined;
      return reply.status(status).send(body(error.code, error.message, fields, details));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply
        .status(400)
        .send(body('VALIDATION_ERROR', 'The request is not valid', fieldsFrom(error.validation)));
    }
    if (isResponseSerializationError(error)) {
      req.log.error({ err: error }, 'response does not match its contract');
      return reply.status(500).send(body('INTERNAL_ERROR', 'Something went wrong'));
    }
    const status = 'statusCode' in error ? error.statusCode : undefined;
    if (status === 429) {
      return reply
        .status(429)
        .send(body('TOO_MANY_REQUESTS', 'Too many requests, try again later'));
    }
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send(body('BAD_REQUEST', error.message));
    }
    req.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(body('INTERNAL_ERROR', 'Something went wrong'));
  });
}
