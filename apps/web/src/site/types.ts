/** View models of the server-rendered public site. Plain data, no DOM or Node types. */

/** The four legal pages (FR-33), in footer order. */
export const legalSlugs = ['terms', 'privacy', 'acceptable-use', 'cookies'] as const;
export type LegalSlug = (typeof legalSlugs)[number];

/** An active Credit pack as the pricing section shows it (FR-34). */
export interface SitePack {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
}

/** Platform settings the site reads (FR-8, FR-9). */
export interface SiteSettings {
  gaMeasurementId: string | null;
  youtubeVideoId: string | null;
  supportEmail: string | null;
}

/** Everything every page needs. */
export interface PageContext {
  /** Absolute origin for canonical URLs, Open Graph and JSON-LD, e.g. `https://llyner.com`. */
  siteUrl: string;
  settings: SiteSettings;
  /** A signed-in visitor sees "Open the app" instead of the card (FR-34). */
  signedIn: boolean;
  year: number;
  /** Cache-busting path of the enhancement script, e.g. `/site/client.js?v=ab12`. */
  clientScriptSrc: string;
  /** Re-rendered form pages (POST /site/*) are not for search engines. */
  noindex?: boolean;
}

export type CardTab = 'signup' | 'login';
export type SignupField = 'businessName' | 'name' | 'email' | 'password';
export type LoginField = 'email' | 'password';

/** The sign-up and log-in card (FR-35): which tab, what was typed, and what went wrong. */
export interface CardState {
  tab: CardTab;
  signup: {
    values: Partial<Record<Exclude<SignupField, 'password'>, string>>;
    errors: Partial<Record<SignupField, string>>;
    message: string | null;
  };
  login: {
    values: { email?: string };
    errors: Partial<Record<LoginField, string>>;
    message: string | null;
  };
}

export function emptyCard(tab: CardTab = 'signup'): CardState {
  return {
    tab,
    signup: { values: {}, errors: {}, message: null },
    login: { values: {}, errors: {}, message: null },
  };
}

export interface LandingModel extends PageContext {
  packs: readonly SitePack[];
  card: CardState;
}

export interface LegalModel extends PageContext {
  slug: LegalSlug;
  /** The Markdown source from `content/legal/<slug>.md`. */
  markdown: string;
}
