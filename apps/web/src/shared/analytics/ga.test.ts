import { afterEach, describe, expect, test } from 'vitest';
import { GTAG_SRC, isTrackedRoute, loadGtag, pageLocation, routePaths, sendPageView } from './ga';

type GaWindow = Window & { dataLayer?: IArguments[]; gtag?: unknown };
const w = window as GaWindow;
const calls = () => (w.dataLayer ?? []).map((args) => Array.from<unknown>(args));
const scripts = () => document.head.querySelectorAll(`script[src^="${GTAG_SRC}"]`);

afterEach(() => {
  for (const s of Array.from(scripts())) s.remove();
  delete w.dataLayer;
  delete w.gtag;
});

describe('FR-9: Google Analytics helpers', () => {
  test('loadGtag adds the tag script once and configures without an automatic page view', () => {
    loadGtag('G-ABC1234');
    loadGtag('G-ABC1234');
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]?.getAttribute('src')).toBe(`${GTAG_SRC}?id=G-ABC1234`);
    const config = calls().filter(([name]) => name === 'config');
    expect(config).toHaveLength(1);
    expect(config[0]).toEqual([
      'config',
      'G-ABC1234',
      expect.objectContaining({ send_page_view: false, allow_google_signals: false }),
    ]);
  });

  test('loadGtag refuses anything that is not a GA4 measurement ID', () => {
    loadGtag('G-1"><script>');
    loadGtag('UA-12345-1');
    expect(scripts()).toHaveLength(0);
    expect(w.dataLayer).toBeUndefined();
  });

  test('sendPageView sends the path only: no query string or hash', () => {
    loadGtag('G-ABC1234');
    sendPageView('G-ABC1234', '/app/reset-password');
    const views = calls().filter(([kind, name]) => kind === 'event' && name === 'page_view');
    expect(views).toEqual([
      [
        'event',
        'page_view',
        {
          send_to: 'G-ABC1234',
          page_path: '/app/reset-password',
          page_location: `${window.location.origin}/app/reset-password`,
        },
      ],
    ]);
  });

  test('pageLocation drops token, next, code and every other query parameter', () => {
    expect(pageLocation('https://llyner.test', '/app/verify-email')).toBe(
      'https://llyner.test/app/verify-email',
    );
  });

  test('routePaths works whether or not the router location carries the basename', () => {
    expect(routePaths('/app', '/app/plans/1')).toEqual({ page: '/app/plans/1', route: '/plans/1' });
    expect(routePaths('/app', '/plans/1')).toEqual({ page: '/app/plans/1', route: '/plans/1' });
    expect(routePaths('/app', '/app')).toEqual({ page: '/app/', route: '/' });
    expect(routePaths(undefined, '/plans')).toEqual({ page: '/plans', route: '/plans' });
  });

  test('back-office routes and Acting-as sessions are not tracked', () => {
    expect(isTrackedRoute('/plans', false)).toBe(true);
    expect(isTrackedRoute('/staff', false)).toBe(false);
    expect(isTrackedRoute('/staff/settings', false)).toBe(false);
    expect(isTrackedRoute('/staffing', false)).toBe(true);
    expect(isTrackedRoute('/plans', true)).toBe(false);
  });
});
