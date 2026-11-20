import type { IdentityUseCases } from '../modules/identity/index.js';
import type { Clock } from '../shared/domain/clock.js';
import type { LegalSlug, SitePack } from '../../../web/src/site/index.js';

/**
 * What the public site reads and calls (FR-33 to FR-35). composition.ts wires the real modules;
 * tests pass fakes.
 */

/** billing: the active Credit packs, cheapest first (FR-13, FR-34). */
export interface SitePacks {
  activePacks(): Promise<readonly SitePack[]>;
}

/** platform's SettingsReader (cached ≤ 60 s) satisfies this structurally (FR-8, FR-9). */
export interface SiteSettingsSource {
  analytics(): Promise<{ gaMeasurementId: string | null }>;
  landing(): Promise<{ youtubeVideoId: string | null }>;
  support(): Promise<{ supportEmail: string | null }>;
}

/** identity's sign-up (FR-1, with `source: 'landing'`) and log-in (FR-3) use cases. */
export type SiteIdentity = Pick<IdentityUseCases, 'signUp' | 'logIn'>;

/** The Markdown drafts in `apps/web/src/content/legal` (FR-33). */
export interface LegalContent {
  read(slug: LegalSlug): Promise<string>;
}

export interface SiteDeps {
  /** APP_URL: canonical URLs, Open Graph, JSON-LD and the forms' Origin check. */
  siteUrl: string;
  /** `Secure` session cookie and `upgrade-insecure-requests`: true in production. */
  secureCookies: boolean;
  clock: Clock;
  packs: SitePacks;
  settings: SiteSettingsSource;
  identity: SiteIdentity;
  legal: LegalContent;
  /** How long rendered pages are cached in memory (FR-34: 5 minutes). */
  cacheTtlMs?: number;
  /** Requests per minute and IP to each `/site/*` form, on top of identity's own limits. */
  formRateLimitPerMinute?: number;
}
