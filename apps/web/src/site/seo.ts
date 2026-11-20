import { siteCopy } from './copy.js';
import type { SitePack } from './types.js';

/** Path of the generated 1200×630 share image (served by the api). */
export const shareImagePath = '/site/share.png';
export const shareImageSize = { width: 1200, height: 630 } as const;

/** YouTube IDs are 11 URL-safe characters (FR-8); anything else is never put in a URL. */
export function isYoutubeId(id: string | null | undefined): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

export const youtube = {
  thumbnail: (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  embed: (id: string) => `https://www.youtube-nocookie.com/embed/${id}`,
};

/** `$25`, `$100`, `$12.50`. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString('en-US')}`
    : `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCredits(credits: number): string {
  return credits.toLocaleString('en-US');
}

/**
 * Bonus over list price (1 credit = $0.01, PRD section 13): 11,000 credits for $100 → 10.
 * Null when the pack gives no extra credits.
 */
export function bonusPercent(pack: SitePack): number | null {
  if (pack.priceCents <= 0) return null;
  const percent = Math.round((pack.credits / pack.priceCents - 1) * 100);
  return percent >= 1 ? percent : null;
}

type JsonLd = Record<string, unknown>;

export function softwareApplicationLd(siteUrl: string, packs: readonly SitePack[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: siteCopy.product,
    url: `${siteUrl}/`,
    description: siteCopy.meta.description,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    image: `${siteUrl}${shareImagePath}`,
    offers: [
      {
        '@type': 'Offer',
        name: siteCopy.pricing.freeOffer,
        description: siteCopy.pricing.freeOfferDescription,
        price: '0',
        priceCurrency: 'USD',
        url: `${siteUrl}/#signup`,
      },
      ...packs.map((pack) => ({
        '@type': 'Offer',
        name: pack.name,
        description: `${formatCredits(pack.credits)} ${siteCopy.pricing.credits}`,
        price: (pack.priceCents / 100).toFixed(2),
        priceCurrency: 'USD',
        url: `${siteUrl}/#pricing`,
      })),
    ],
  };
}

export function faqPageLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: siteCopy.faq.items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

export function videoObjectLd(videoId: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: siteCopy.video.title,
    description: siteCopy.video.description,
    thumbnailUrl: [youtube.thumbnail(videoId)],
    embedUrl: youtube.embed(videoId),
    contentUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

/** JSON for a `<script type="application/ld+json">`: `<` is escaped so no tag can close it. */
export function jsonLdText(data: JsonLd): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
