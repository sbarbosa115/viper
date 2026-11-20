import type { Source } from '@app/contracts/common';
import type { ContactType, LeadSummary } from '@app/contracts/leads';

const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const formatDate = (iso: string): string => date.format(new Date(iso));

export const formatMiles = (miles: number | null): string | null =>
  miles === null ? null : `${Number(miles.toFixed(1))} mi`;

export function describeSource(source: Source): string {
  return `${source.name} · ${formatDate(source.retrievedAt)}`;
}

export const contactTypeLabels: Record<ContactType, string> = {
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  yelp: 'Yelp',
  facebook: 'Facebook',
};

const shortContact: Record<keyof LeadSummary['contacts'], string> = {
  phone: 'phone',
  email: 'email',
  website: 'web',
  instagram: 'IG',
  tiktok: 'TikTok',
};

/** "phone · email · IG" for the list rows. */
export function contactSummary(contacts: LeadSummary['contacts']): string[] {
  return (Object.keys(shortContact) as (keyof LeadSummary['contacts'])[])
    .filter((k) => contacts[k])
    .map((k) => shortContact[k]);
}

export const formatPoints = (points: number): string =>
  points < 0 ? `−${Math.abs(points)}` : `+${points}`;

/** A website value as a clickable address. */
export const websiteHref = (value: string): string =>
  /^https?:\/\//i.test(value) ? value : `https://${value}`;

/** Only http(s) links are rendered as links. */
export const safeUrl = (url: string | null): string | null =>
  url !== null && /^https?:\/\//i.test(url) ? url : null;
