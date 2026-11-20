import type { EmailMessage } from '../../../shared/application/email-sender.js';
import type { IdentityServices } from './ports.js';

const PRODUCT = 'Llyner Leads';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function link(appUrl: string, path: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}${path}?token=${encodeURIComponent(token)}`;
}

function html(name: string, intro: string, url: string, action: string, outro: string): string {
  const safeUrl = escapeHtml(url);
  return [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>${intro}</p>`,
    `<p><a href="${safeUrl}">${action}</a></p>`,
    `<p>${outro}</p>`,
    `<p>— ${PRODUCT}</p>`,
  ].join('\n');
}

/** FR-2: the verification link, valid 24 h. */
export function verificationEmail(p: {
  to: string;
  name: string;
  appUrl: string;
  token: string;
}): EmailMessage {
  const url = link(p.appUrl, '/app/verify-email', p.token);
  const intro = `Confirm your email to get 50 free credits and start research with ${PRODUCT}.`;
  const outro = 'The link works for 24 hours. If you did not sign up, ignore this email.';
  return {
    to: p.to,
    subject: `Verify your email for ${PRODUCT}`,
    text: `Hi ${p.name},\n\n${intro}\n\n${url}\n\n${outro}\n\n— ${PRODUCT}\n`,
    html: html(p.name, intro, url, 'Verify my email', outro),
  };
}

/** FR-4: the password reset link, valid 1 h. */
export function passwordResetEmail(p: {
  to: string;
  name: string;
  appUrl: string;
  token: string;
}): EmailMessage {
  const url = link(p.appUrl, '/app/reset-password', p.token);
  const intro = `Someone asked to reset the password of your ${PRODUCT} account.`;
  const outro =
    'The link works for 1 hour and only once. If it was not you, ignore this email; your password stays the same.';
  return {
    to: p.to,
    subject: `Reset your ${PRODUCT} password`,
    text: `Hi ${p.name},\n\n${intro}\n\n${url}\n\n${outro}\n\n— ${PRODUCT}\n`,
    html: html(p.name, intro, url, 'Choose a new password', outro),
  };
}

/** A failed email never fails the request: the Member can ask for another link. */
export async function sendSafely(
  s: Pick<IdentityServices, 'logger'>,
  send: () => Promise<void>,
): Promise<void> {
  try {
    await send();
  } catch (err) {
    s.logger.warn({ err }, 'identity email could not be sent');
  }
}
