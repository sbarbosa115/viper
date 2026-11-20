import { z } from 'zod';
import { defineContract, err } from './common.js';
import { loginBody, signupBody } from './identity.js';

/**
 * The server-rendered public site (FR-33 to FR-35, ADR 0016). Not under `/api`: these return
 * HTML (or XML/text), and the forms post `application/x-www-form-urlencoded`.
 */

const html = z.string();

function page(path: string) {
  return defineContract({
    method: 'GET',
    path,
    auth: 'public',
    status: 200,
    contentType: 'text/html',
    response: html,
  });
}

export const landingPage = page('/');
export const termsPage = page('/terms');
export const privacyPage = page('/privacy');
export const acceptableUsePage = page('/acceptable-use');
export const cookiesPage = page('/cookies');

export const sitemap = defineContract({
  method: 'GET',
  path: '/sitemap.xml',
  auth: 'public',
  status: 200,
  contentType: 'application/xml',
  response: z.string(),
});

export const robots = defineContract({
  method: 'GET',
  path: '/robots.txt',
  auth: 'public',
  status: 200,
  contentType: 'text/plain',
  response: z.string(),
});

/**
 * FR-35. 303 → `/app` on success; on failure 200 with the landing page re-rendered and the errors
 * in the card (EMAIL_TAKEN switches to the Log in tab).
 */
export const siteSignup = defineContract({
  method: 'POST',
  path: '/site/signup',
  auth: 'public',
  status: 303,
  formBody: true,
  body: signupBody,
  contentType: 'text/html',
  response: html,
  errors: [err(409, 'EMAIL_TAKEN'), err(429, 'TOO_MANY_REQUESTS')],
});

/** FR-35. 303 → `/app` (Staff → `/app/login/two-factor`). */
export const siteLogin = defineContract({
  method: 'POST',
  path: '/site/login',
  auth: 'public',
  status: 303,
  formBody: true,
  body: loginBody,
  contentType: 'text/html',
  response: html,
  errors: [err(401, 'INVALID_CREDENTIALS'), err(429, 'TOO_MANY_REQUESTS')],
});

export const siteContracts = {
  landingPage,
  termsPage,
  privacyPage,
  acceptableUsePage,
  cookiesPage,
  sitemap,
  robots,
  siteSignup,
  siteLogin,
} as const;
