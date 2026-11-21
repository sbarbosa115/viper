import {
  categoryLabels,
  staffStatusLabel,
  type Category,
  type Status,
} from '@app/contracts/support';
import type { EmailMessage } from '../../../shared/application/email-sender.js';

const PRODUCT = 'Llyner Leads';
const FROM_NAME = 'Llyner Leads Support';
/** Midnight colours inlined for email clients, which ignore CSS variables (DESIGN.md). */
const C = {
  page: '#1C1C26',
  card: '#0A0A0F',
  panel: '#13131A',
  line: '#24242E',
  text: '#EDEDF2',
  body: '#D4D4DE',
  muted: '#9A9AA8',
  faint: '#80808E',
  accent: '#BEF264',
  accentText: '#0A0A0F',
} as const;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Plain-text message to HTML: escaped, with line breaks kept. */
export function messageHtml(value: string): string {
  return escapeHtml(value.replace(/\r\n?/g, '\n')).replaceAll('\n', '<br>');
}

const REPLY_NOTE =
  "Reply in Llyner Leads to keep everything in one place. Replies to this email aren't read.";
const REOPEN_NOTE = "We've closed this ticket. Reply within 30 days to reopen it.";

export type TicketLinkAudience = 'customer' | 'staff';

export function ticketUrl(appUrl: string, audience: TicketLinkAudience, number: number): string {
  const base = appUrl.replace(/\/+$/, '');
  return audience === 'staff'
    ? `${base}/app/staff/support/${number}`
    : `${base}/app/support/${number}`;
}

const tag = (number: number): string => `[#${number}]`;

interface Layout {
  heading: string;
  /** Label and value rows (value is plain text). */
  facts?: readonly (readonly [string, string])[];
  subheading?: string;
  message?: string | null;
  intro?: string;
  button: { label: string; url: string };
  footer: string;
  staff: boolean;
}

function render(l: Layout): { text: string; html: string } {
  const text = [
    l.heading,
    ...(l.subheading ? [l.subheading] : []),
    '',
    ...(l.intro ? [l.intro, ''] : []),
    ...(l.facts ? [...l.facts.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...(l.message ? [l.message, ''] : []),
    `${l.button.label}: ${l.button.url}`,
    '',
    l.footer,
    '',
    `— ${PRODUCT}`,
    '',
  ].join('\n');
  const factRows = (l.facts ?? [])
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;font-size:12px;color:${C.muted}">${escapeHtml(k)}</td><td style="padding:2px 0;font-size:14px;color:${C.body}">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  const html = [
    `<div style="margin:0;padding:28px;background:${C.page};font-family:Geist,system-ui,-apple-system,Segoe UI,sans-serif">`,
    `<div style="max-width:560px;margin:0 auto;background:${C.card};border:1px solid ${C.line};border-radius:14px;padding:32px;color:${C.text}">`,
    `<p style="margin:0 0 16px;font-size:15px">${PRODUCT}${l.staff ? ` <span style="font-size:11px;color:#FBBF24">STAFF</span>` : ''}</p>`,
    `<h1 style="margin:0 0 6px;font-size:22px;font-weight:600">${escapeHtml(l.heading)}</h1>`,
    ...(l.subheading
      ? [
          `<p style="margin:0 0 16px;font-size:13px;color:${C.muted}">${escapeHtml(l.subheading)}</p>`,
        ]
      : []),
    ...(l.intro
      ? [`<p style="margin:0 0 16px;font-size:14px;color:${C.body}">${escapeHtml(l.intro)}</p>`]
      : []),
    ...(factRows
      ? [
          `<table role="presentation" style="margin:0 0 16px;border-collapse:collapse">${factRows}</table>`,
        ]
      : []),
    ...(l.message
      ? [
          `<div style="margin:0 0 20px;padding:16px 18px;border-radius:12px;background:${C.panel};border:1px solid ${C.line};font-size:15px;line-height:1.6;color:${C.body}">${messageHtml(l.message)}</div>`,
        ]
      : []),
    `<p style="margin:0 0 20px"><a href="${escapeHtml(l.button.url)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${C.accent};color:${C.accentText};font-weight:600;font-size:15px;text-decoration:none">${escapeHtml(l.button.label)}</a></p>`,
    `<p style="margin:0;font-size:12px;line-height:1.5;color:${C.faint}">${escapeHtml(l.footer)}</p>`,
    '</div></div>',
  ].join('\n');
  return { text, html };
}

export interface TicketOpenedFacts {
  to: string;
  appUrl: string;
  number: number;
  subject: string;
  category: Category;
  businessName: string;
  openedBy: { name: string; role: 'owner' | 'member' | null };
  run: { planName: string; status: string } | null;
  message: string;
}

/** FR-11: "New ticket" to a Staff Member. */
export function ticketOpenedEmail(f: TicketOpenedFacts): EmailMessage {
  const role =
    f.openedBy.role === 'owner' ? 'Owner' : f.openedBy.role === 'member' ? 'Member' : null;
  const rendered = render({
    staff: true,
    heading: `New ticket: ${f.subject}`,
    facts: [
      ['Business', f.businessName],
      ['From', role ? `${f.openedBy.name} · ${role}` : f.openedBy.name],
      ['Category', categoryLabels[f.category]],
      ...(f.run
        ? ([['Linked run', `${f.run.planName} · ${f.run.status.toUpperCase()}`]] as const)
        : []),
    ],
    message: f.message,
    button: { label: 'Open in the Support desk', url: ticketUrl(f.appUrl, 'staff', f.number) },
    footer: `You get this because you are Staff on ${PRODUCT}. Customer replies send the same email, marked "New reply", to the assignee once someone takes the ticket.`,
  });
  return {
    to: f.to,
    fromName: FROM_NAME,
    subject: `${tag(f.number)} New ticket · ${categoryLabels[f.category]} · ${f.businessName}`,
    ...rendered,
  };
}

export interface CustomerRepliedFacts {
  to: string;
  appUrl: string;
  number: number;
  subject: string;
  businessName: string;
  status: Status;
  message: string;
}

/** FR-11: "New reply" to the assignee (or every Staff Member). */
export function customerRepliedEmail(f: CustomerRepliedFacts): EmailMessage {
  const rendered = render({
    staff: true,
    heading: `New reply: ${f.subject}`,
    subheading: `#${f.number} · ${f.businessName} · ${staffStatusLabel(f.status)}`,
    message: f.message,
    button: { label: 'Open in the Support desk', url: ticketUrl(f.appUrl, 'staff', f.number) },
    footer: `You get this because you are Staff on ${PRODUCT}.`,
  });
  return {
    to: f.to,
    fromName: FROM_NAME,
    subject: `${tag(f.number)} New reply · ${f.businessName}`,
    ...rendered,
  };
}

export interface StaffRepliedFacts {
  to: string;
  appUrl: string;
  number: number;
  subject: string;
  businessName: string;
  message: string;
}

/** FR-11: "We replied to your ticket" to the opener. */
export function staffRepliedEmail(f: StaffRepliedFacts): EmailMessage {
  const rendered = render({
    staff: false,
    heading: 'We replied to your ticket',
    subheading: `#${f.number} · ${f.subject}`,
    message: f.message,
    button: { label: 'Open the ticket', url: ticketUrl(f.appUrl, 'customer', f.number) },
    footer: `${REPLY_NOTE} You get this because you opened ticket #${f.number} for ${f.businessName}.`,
  });
  return {
    to: f.to,
    fromName: FROM_NAME,
    subject: `${tag(f.number)} New reply: ${f.subject}`,
    ...rendered,
  };
}

export interface TicketClosedFacts {
  to: string;
  appUrl: string;
  number: number;
  subject: string;
  businessName: string;
  /** The closing reply, when one was sent with the close. */
  message: string | null;
}

/** FR-11: "Closed" to the opener (Staff closes only). */
export function ticketClosedEmail(f: TicketClosedFacts): EmailMessage {
  const rendered = render({
    staff: false,
    heading: 'We closed your ticket',
    subheading: `#${f.number} · ${f.subject}`,
    intro: REOPEN_NOTE,
    message: f.message,
    button: { label: 'Open the ticket', url: ticketUrl(f.appUrl, 'customer', f.number) },
    footer: `${REPLY_NOTE} You get this because you opened ticket #${f.number} for ${f.businessName}.`,
  });
  return {
    to: f.to,
    fromName: FROM_NAME,
    subject: `${tag(f.number)} Closed: ${f.subject}`,
    ...rendered,
  };
}
