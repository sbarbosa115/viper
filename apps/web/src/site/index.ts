/**
 * The server-rendered public site (FR-33 to FR-35, ADR 0016): pages, styles and the client
 * script, rendered by the api (`apps/api/src/site`). Nothing here runs in the SPA.
 */
export { renderLandingPage, renderLegalPage } from './render.js';
export { siteClientScript } from './client.js';
export { siteCopy } from './copy.js';
export { formatIsoDate, parseLegalDocument } from './markdown.js';
export { isYoutubeId, shareImagePath } from './seo.js';
export { midnightTokens } from './tokens.js';
export {
  emptyCard,
  legalSlugs,
  type CardState,
  type CardTab,
  type LandingModel,
  type LegalModel,
  type LegalSlug,
  type LoginField,
  type PageContext,
  type SignupField,
  type SitePack,
  type SiteSettings,
} from './types.js';
