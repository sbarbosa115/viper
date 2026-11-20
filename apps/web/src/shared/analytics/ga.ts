/**
 * Google Analytics page views for the SPA (FR-9). gtag loads only when Platform settings hold a
 * measurement ID. Hits carry the page path only: no query string (it can hold sign-in tokens,
 * `next` or codes), no hash, no user IDs, emails or names.
 */

export const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js';

const MEASUREMENT_ID = /^G-[A-Za-z0-9]{4,12}$/;

type Gtag = (...args: unknown[]) => void;
type GaWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

/** The full URL GA receives: origin and path, nothing else. */
export function pageLocation(origin: string, path: string): string {
  return origin + path;
}

/**
 * The page path GA receives (with the basename) and the route path (without it), whether or not
 * the router's location carries the basename.
 */
export function routePaths(
  basename: string | undefined,
  pathname: string,
): { page: string; route: string } {
  const base = basename && basename !== '/' ? basename.replace(/\/$/, '') : '';
  if (!base) return { page: pathname, route: pathname };
  const route =
    pathname === base || pathname.startsWith(`${base}/`)
      ? pathname.slice(base.length) || '/'
      : pathname;
  return { page: base + route, route };
}

/** Back-office routes and Acting-as sessions send no page views (FR-9). */
export function isTrackedRoute(route: string, actingAs: boolean): boolean {
  if (actingAs) return false;
  return !(route === '/staff' || route.startsWith('/staff/'));
}

function gtagOf(w: GaWindow): Gtag {
  w.dataLayer = w.dataLayer ?? [];
  const layer = w.dataLayer;
  // gtag reads the `arguments` object, not an array.
  w.gtag =
    w.gtag ??
    function gtag() {
      // eslint-disable-next-line prefer-rest-params
      layer.push(arguments);
    };
  return w.gtag;
}

/** Adds Google's tag once and configures it without an automatic page view. */
export function loadGtag(measurementId: string): void {
  if (!MEASUREMENT_ID.test(measurementId)) return;
  const src = `${GTAG_SRC}?id=${measurementId}`;
  if (document.head.querySelector(`script[src="${src}"]`)) return;
  const gtag = gtagOf(window);
  gtag('js', new Date());
  gtag('config', measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const tag = document.createElement('script');
  tag.async = true;
  tag.src = src;
  document.head.appendChild(tag);
}

/** One `page_view` for `path` (already stripped of query and hash). */
export function sendPageView(measurementId: string, path: string): void {
  if (!MEASUREMENT_ID.test(measurementId)) return;
  const gtag = gtagOf(window);
  const location = pageLocation(window.location.origin, path);
  // Later automatic hits (engagement, scrolls) reuse these instead of the address bar's URL.
  gtag('set', { page_location: location, page_path: path });
  gtag('event', 'page_view', { send_to: measurementId, page_path: path, page_location: location });
}
