import { z } from 'zod';
import { defineContract, email, emailInput, err, id, noContent } from './common.js';

// Shapes -----------------------------------------------------------------------------------------

export const businessName = z.string().trim().min(2).max(120);
export const memberName = z.string().trim().min(1).max(80);
/** New passwords: 10–128 characters (FR-1, FR-4). */
export const newPassword = z.string().min(10).max(128);
const anyPassword = z.string().min(1).max(128);
const token = z.string().min(1).max(256);

/** The signed-in Member, their Business, Acting as and two-factor state (PRD section 7). */
export const me = z.object({
  member: z.object({
    id,
    name: z.string(),
    email,
    emailVerified: z.boolean(),
    isStaff: z.boolean(),
  }),
  business: z.object({ id, name: z.string() }),
  actingAs: z.object({ businessId: id, businessName: z.string() }).nullable(),
  twoFactor: z.object({ required: z.boolean(), passed: z.boolean(), setUp: z.boolean() }),
});
export type Me = z.infer<typeof me>;

export const signupBody = z.object({
  businessName,
  name: memberName,
  email: emailInput,
  password: newPassword,
});
export type SignupBody = z.infer<typeof signupBody>;

export const loginBody = z.object({ email: emailInput, password: anyPassword });
export type LoginBody = z.infer<typeof loginBody>;

export const twoFactorCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

// Endpoints --------------------------------------------------------------------------------------

/** FR-1. Creates a Business, an Owner and a session; sends the verification email. */
export const signup = defineContract({
  method: 'POST',
  path: '/api/auth/signup',
  auth: 'public',
  status: 201,
  body: signupBody,
  response: me,
  errors: [err(409, 'EMAIL_TAKEN'), err(429, 'TOO_MANY_REQUESTS')],
});

/** FR-2. */
export const verifyEmail = defineContract({
  method: 'POST',
  path: '/api/auth/verify-email',
  auth: 'public',
  status: 200,
  body: z.object({ token }),
  response: z.object({ verified: z.literal(true) }),
  errors: [err(410, 'TOKEN_EXPIRED')],
});

/** FR-2. At most once per 60 s and 5 per day. */
export const resendVerificationEmail = defineContract({
  method: 'POST',
  path: '/api/auth/verify-email/resend',
  auth: 'session',
  status: 202,
  response: noContent,
  errors: [err(429, 'TOO_MANY_REQUESTS')],
});

/** FR-3. Staff get `twoFactor.required = true, passed = false` and a half-session. */
export const login = defineContract({
  method: 'POST',
  path: '/api/auth/login',
  auth: 'public',
  status: 200,
  body: loginBody,
  response: me,
  errors: [err(401, 'INVALID_CREDENTIALS'), err(429, 'TOO_MANY_REQUESTS')],
});

/** FR-5. First Staff login: the QR code and secret to add to an authenticator. */
export const twoFactorSetup = defineContract({
  method: 'POST',
  path: '/api/auth/two-factor/setup',
  auth: 'halfSession',
  status: 200,
  response: z.object({
    otpauthUrl: z.string().startsWith('otpauth://'),
    secret: z.string().min(16),
    qrSvg: z.string().min(1),
  }),
  errors: [err(409, 'CONFLICT')],
});

/** FR-5. 5 wrong codes delete the half-session. */
export const twoFactorVerify = defineContract({
  method: 'POST',
  path: '/api/auth/two-factor/verify',
  auth: 'halfSession',
  status: 200,
  body: z.object({ code: twoFactorCode }),
  response: me,
  errors: [err(401, 'INVALID_CODE'), err(429, 'TOO_MANY_REQUESTS'), err(429, 'TWO_FACTOR_LOCKED')],
});

/** FR-3. Deletes the session (and ends any Acting as). */
export const logout = defineContract({
  method: 'POST',
  path: '/api/auth/logout',
  auth: 'session',
  status: 204,
  response: noContent,
});

export const getMe = defineContract({
  method: 'GET',
  path: '/api/auth/me',
  auth: 'session',
  status: 200,
  response: me,
});

/** FR-4. Always 202 (no account enumeration); 3 per email per hour. */
export const requestPasswordReset = defineContract({
  method: 'POST',
  path: '/api/auth/password-reset',
  auth: 'public',
  status: 202,
  body: z.object({ email: emailInput }),
  response: noContent,
});

/** FR-4. Deletes all of the Member's sessions and signs them in (Staff still need the code). */
export const confirmPasswordReset = defineContract({
  method: 'POST',
  path: '/api/auth/password-reset/confirm',
  auth: 'public',
  status: 200,
  body: z.object({ token, password: newPassword }),
  response: me,
  errors: [err(410, 'TOKEN_EXPIRED')],
});

/** FR-4. Signed-in change; blocked while Acting as (FR-6). */
export const changePassword = defineContract({
  method: 'PUT',
  path: '/api/auth/password',
  auth: 'session',
  status: 204,
  body: z.object({ currentPassword: anyPassword, newPassword }),
  response: noContent,
  errors: [err(401, 'INVALID_CREDENTIALS'), err(403, 'ACTING_AS_FORBIDDEN')],
});

/** FR-6. Replaces any current Acting as. */
export const startActingAs = defineContract({
  method: 'POST',
  path: '/api/staff/acting-as',
  auth: 'staff',
  status: 200,
  body: z.object({ businessId: id }),
  response: me,
  errors: [err(404, 'NOT_FOUND')],
});

/** FR-6. */
export const stopActingAs = defineContract({
  method: 'DELETE',
  path: '/api/staff/acting-as',
  auth: 'staff',
  status: 200,
  response: me,
});

export const identityContracts = {
  signup,
  verifyEmail,
  resendVerificationEmail,
  login,
  twoFactorSetup,
  twoFactorVerify,
  logout,
  getMe,
  requestPasswordReset,
  confirmPasswordReset,
  changePassword,
  startActingAs,
  stopActingAs,
} as const;
