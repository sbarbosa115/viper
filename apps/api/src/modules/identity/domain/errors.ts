import { CodedError } from '../../../shared/domain/errors.js';

/** The identity error codes of PRD sections 6 and 7; the central handler maps each to its status. */
export const identityErrors = {
  emailTaken: () =>
    new CodedError(
      'EMAIL_TAKEN',
      'An account with this email already exists. Log in or reset your password.',
    ),
  invalidCredentials: () =>
    new CodedError('INVALID_CREDENTIALS', 'The email or password is not correct.'),
  tokenExpired: () => new CodedError('TOKEN_EXPIRED', 'This link has expired or was already used.'),
  tooManyRequests: (retryAfterSeconds: number) =>
    new CodedError('TOO_MANY_REQUESTS', 'Too many attempts. Try again later.', {
      retryAfterSeconds,
    }),
  invalidCode: () => new CodedError('INVALID_CODE', 'That code is not correct.'),
  twoFactorRequired: () =>
    new CodedError('TWO_FACTOR_REQUIRED', 'Enter your two-factor code to continue.'),
  actingAsForbidden: () =>
    new CodedError('ACTING_AS_FORBIDDEN', 'Not available while Acting as a Business.'),
} as const;
