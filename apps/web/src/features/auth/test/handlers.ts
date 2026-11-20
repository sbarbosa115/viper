import { errorResponse } from '@app/contracts/errors';
import { me as meExample } from '@app/contracts/examples';
import {
  loginBody,
  me as meSchema,
  newPassword,
  signupBody,
  twoFactorCode,
  twoFactorSetup,
  verifyEmail,
  type Me,
} from '@app/contracts/identity';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';

/** Tweak per test; `resetAuthState()` runs in the tests' beforeEach. */
export const authState: { session: Me | null; resendStatus: 202 | 429 | 401 } = {
  session: null,
  resendStatus: 202,
};

export function resetAuthState() {
  authState.session = null;
  authState.resendStatus = 202;
}

export const staffMe = (overrides: Partial<Me['twoFactor']> = {}): Me =>
  meSchema.parse({
    ...meExample,
    member: { ...meExample.member, email: 'staff@llyner.example', isStaff: true },
    twoFactor: { required: true, passed: false, setUp: true, ...overrides },
  });

function fail(status: number, code: string, message: string, fields?: Record<string, string>) {
  return HttpResponse.json(errorResponse.parse({ error: { code, message, fields } }), { status });
}

function invalid(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join('.')] = issue.message;
  return fail(400, 'VALIDATION_ERROR', 'Invalid request', fields);
}

const tokenBody = z.object({ token: z.string().min(1) });
const resetBody = z.object({ token: z.string().min(1), password: newPassword });
const codeBody = z.object({ code: twoFactorCode });
const emailBody = z.object({ email: z.string() });

export const handlers = [
  http.get('*/api/auth/me', () =>
    authState.session
      ? HttpResponse.json(meSchema.parse(authState.session))
      : fail(401, 'UNAUTHENTICATED', 'Sign in'),
  ),

  http.post('*/api/auth/signup', async ({ request }) => {
    const parsed = signupBody.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    if (parsed.data.email.startsWith('taken@')) return fail(409, 'EMAIL_TAKEN', 'Email taken');
    if (parsed.data.email.startsWith('limited@')) return fail(429, 'TOO_MANY_REQUESTS', 'Slow down');
    authState.session = meSchema.parse({
      ...meExample,
      member: {
        ...meExample.member,
        name: parsed.data.name,
        email: parsed.data.email,
        emailVerified: false,
      },
      business: { ...meExample.business, name: parsed.data.businessName },
    });
    return HttpResponse.json(authState.session, { status: 201 });
  }),

  http.post('*/api/auth/login', async ({ request }) => {
    const parsed = loginBody.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    const { email, password } = parsed.data;
    if (email.startsWith('limited@')) return fail(429, 'TOO_MANY_REQUESTS', 'Slow down');
    if (password === 'wrong-password') return fail(401, 'INVALID_CREDENTIALS', 'Wrong');
    authState.session = email.startsWith('staff@') ? staffMe() : meSchema.parse(meExample);
    return HttpResponse.json(authState.session);
  }),

  http.post('*/api/auth/logout', () => {
    authState.session = null;
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('*/api/auth/verify-email', async ({ request }) => {
    const parsed = tokenBody.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    if (parsed.data.token !== 'valid') return fail(410, 'TOKEN_EXPIRED', 'Expired');
    return HttpResponse.json(verifyEmail.response.parse({ verified: true }));
  }),

  http.post('*/api/auth/verify-email/resend', () => {
    if (authState.resendStatus === 401) return fail(401, 'UNAUTHENTICATED', 'Sign in');
    if (authState.resendStatus === 429) return fail(429, 'TOO_MANY_REQUESTS', 'Wait');
    return new HttpResponse(null, { status: 202 });
  }),

  http.post('*/api/auth/two-factor/setup', () =>
    HttpResponse.json(
      twoFactorSetup.response.parse({
        otpauthUrl: 'otpauth://totp/Llyner:staff@llyner.example?secret=JBSWY3DPEHPK3PXP',
        secret: 'JBSWY3DPEHPK3PXP',
        qrSvg: '<svg viewBox="0 0 2 2" xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>',
      }),
    ),
  ),

  http.post('*/api/auth/two-factor/verify', async ({ request }) => {
    const parsed = codeBody.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    if (parsed.data.code === '999999') return fail(429, 'TOO_MANY_REQUESTS', 'Start over');
    if (parsed.data.code !== '123456') return fail(401, 'INVALID_CODE', 'Wrong code');
    authState.session = staffMe({ passed: true, setUp: true });
    return HttpResponse.json(authState.session);
  }),

  http.post('*/api/auth/password-reset', async ({ request }) => {
    const parsed = emailBody.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    if (parsed.data.email.startsWith('limited@')) return fail(429, 'RATE_LIMITED', 'Slow down');
    return new HttpResponse(null, { status: 202 });
  }),

  http.post('*/api/auth/password-reset/confirm', async ({ request }) => {
    const parsed = resetBody.safeParse(await request.json());
    if (!parsed.success) return invalid(parsed.error);
    if (parsed.data.token !== 'valid') return fail(410, 'TOKEN_EXPIRED', 'Expired');
    authState.session = meSchema.parse(meExample);
    return HttpResponse.json(authState.session);
  }),
];
