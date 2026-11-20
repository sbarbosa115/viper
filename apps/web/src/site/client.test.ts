import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { siteClient, siteClientScript } from './client';
import { renderLandingPage } from './render';
import { emptyCard, type LandingModel } from './types';

function load(overrides: Partial<LandingModel> = {}): void {
  const html = renderLandingPage({
    siteUrl: 'http://localhost',
    settings: { gaMeasurementId: null, youtubeVideoId: null, supportEmail: null },
    signedIn: false,
    year: 2026,
    clientScriptSrc: '/site/client.js',
    packs: [{ id: 'p1', name: 'Starter', credits: 2_500, priceCents: 2_500 }],
    card: emptyCard(),
    ...overrides,
  });
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  for (const attr of Array.from(parsed.body.attributes)) {
    document.body.setAttribute(attr.name, attr.value);
  }
  siteClient();
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function submit(form: string, fields: Record<string, string>): void {
  const el = document.querySelector<HTMLFormElement>(`form[data-site-form="${form}"]`);
  for (const [name, value] of Object.entries(fields)) {
    const input = el?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (input) input.value = value;
  }
  el?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

function replyWith(status: number, body: unknown) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
}

beforeEach(() => {
  document.body.removeAttribute('data-ga-id');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FR-35: card enhancement', () => {
  test('tabs switch in place, without navigating', () => {
    load();
    const login = byId<HTMLAnchorElement>('tab-login');
    const click = new MouseEvent('click', { cancelable: true, bubbles: true });
    login.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(login.getAttribute('aria-selected')).toBe('true');
    expect(byId('panel-login').hidden).toBe(false);
    expect(byId('panel-signup').hidden).toBe(true);
  });

  test('"Start free" anywhere selects Create account and focuses its first field', () => {
    load({ card: emptyCard('login') });
    const start = document.querySelector<HTMLAnchorElement>('.cta a[data-tab-link="signup"]');
    start?.click();
    expect(byId('panel-signup').hidden).toBe(false);
    expect(document.activeElement?.id).toBe('signup-businessName');
  });

  test('sign-up posts the form as JSON-accepting fetch and follows the redirect', async () => {
    load();
    const fetchMock = replyWith(200, { redirect: '/app' });
    vi.stubGlobal('fetch', fetchMock);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, origin: 'http://localhost' });
    submit('signup', {
      businessName: 'Sweet Supply Co',
      name: 'Sam',
      email: 'sam@x.test',
      password: 'long-enough-1',
    });
    await flush();
    await flush();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/site\/signup$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
    expect((init.body as URLSearchParams).toString()).toBe(
      'businessName=Sweet+Supply+Co&name=Sam&email=sam%40x.test&password=long-enough-1',
    );
    expect(assign).toHaveBeenCalledWith('/app');
  });

  test('field errors show inline next to their inputs', async () => {
    load();
    vi.stubGlobal(
      'fetch',
      replyWith(400, {
        error: { code: 'VALIDATION_ERROR', message: 'x', fields: { password: 'Too short' } },
        tab: 'signup',
      }),
    );
    submit('signup', {
      businessName: 'Sweet',
      name: 'Sam',
      email: 'a@b.co',
      password: 'short-pw-1',
    });
    await flush();
    await flush();
    expect(byId('signup-password-error').textContent).toBe('Too short');
    expect(byId('signup-password').getAttribute('aria-invalid')).toBe('true');
  });

  test('email taken switches to Log in with the email filled and the message', async () => {
    load();
    vi.stubGlobal(
      'fetch',
      replyWith(409, {
        error: { code: 'EMAIL_TAKEN', message: 'You already have an account. Log in instead.' },
        tab: 'login',
        email: 'sam@x.test',
      }),
    );
    submit('signup', {
      businessName: 'Sweet',
      name: 'Sam',
      email: 'sam@x.test',
      password: 'long-enough-1',
    });
    await flush();
    await flush();
    expect(byId('panel-login').hidden).toBe(false);
    expect(byId<HTMLInputElement>('login-email').value).toBe('sam@x.test');
    expect(document.querySelector('[data-form-error="login"]')?.textContent).toBe(
      'You already have an account. Log in instead.',
    );
    expect(document.activeElement?.id).toBe('login-password');
  });
});

describe('FR-34: video facade and analytics', () => {
  test('the iframe (youtube-nocookie) is created only on click', () => {
    load({
      settings: { gaMeasurementId: null, youtubeVideoId: 'dQw4w9WgXcQ', supportEmail: null },
    });
    expect(document.querySelector('iframe')).toBeNull();
    document.querySelector<HTMLAnchorElement>('a[data-video-id]')?.click();
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0',
    );
  });

  test('no measurement ID: no Google tag', () => {
    load();
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
  });

  test('a measurement ID loads gtag and sends a page view with the path only', () => {
    load({ settings: { gaMeasurementId: 'G-ABC1234', youtubeVideoId: null, supportEmail: null } });
    expect(document.querySelector('script[src*="googletagmanager"]')?.getAttribute('src')).toBe(
      'https://www.googletagmanager.com/gtag/js?id=G-ABC1234',
    );
    const layer = (window as unknown as { dataLayer: IArguments[] }).dataLayer;
    const config = layer.map((a) => Array.from(a) as unknown[]).find((a) => a[0] === 'config');
    expect(config?.[1]).toBe('G-ABC1234');
    expect(config?.[2]).toEqual({
      page_location: `${window.location.origin}${window.location.pathname}`,
      page_path: window.location.pathname,
    });
  });

  test('the fonts stylesheet is switched on', () => {
    load();
    expect(document.querySelector<HTMLLinkElement>('link[data-fonts]')?.media).toBe('all');
  });

  test('the served script is the same function, self-invoking', () => {
    expect(siteClientScript).toContain('use strict');
    expect(siteClientScript.trim().endsWith('})();')).toBe(true);
    // Parsing the served text proves the serialized function is valid JavaScript.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    expect(() => new Function(siteClientScript)).not.toThrow();
  });
});
