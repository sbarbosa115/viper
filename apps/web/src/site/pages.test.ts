import { describe, expect, test } from 'vitest';
import terms from '../content/legal/terms.md?raw';
import { renderLandingPage, renderLegalPage } from './render';
import { emptyCard, type LandingModel, type SitePack } from './types';

const packs: SitePack[] = [
  { id: 'p1', name: 'Starter', credits: 2_500, priceCents: 2_500 },
  { id: 'p2', name: 'Growth', credits: 11_000, priceCents: 10_000 },
  { id: 'p3', name: 'Pro', credits: 30_000, priceCents: 25_000 },
];

function model(overrides: Partial<LandingModel> = {}): LandingModel {
  return {
    siteUrl: 'https://leads.example',
    settings: { gaMeasurementId: null, youtubeVideoId: null, supportEmail: null },
    signedIn: false,
    year: 2026,
    clientScriptSrc: '/site/client.js?v=abc',
    packs,
    card: emptyCard(),
    ...overrides,
  };
}

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

function jsonLd(doc: Document): Record<string, unknown>[] {
  return Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
    (s) => JSON.parse(s.textContent ?? '') as Record<string, unknown>,
  );
}

describe('FR-34: landing page markup', () => {
  test('a crawler gets the headline, the live pack prices and the JSON-LD', () => {
    const html = renderLandingPage(model());
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    const doc = parse(html);
    expect(doc.querySelector('h1')?.textContent).toBe(
      'Find the businesses most likely to buy what you sell.',
    );
    const prices = Array.from(doc.querySelectorAll('.pack-price')).map((p) => p.textContent);
    expect(prices).toEqual(['$25', '$100', '$250']);
    expect(doc.body.textContent).toContain('11,000 credits');
    expect(doc.body.textContent).toContain('10% bonus');
    expect(doc.body.textContent).toContain('20% bonus');
    expect(doc.body.textContent).toContain('50 free credits');
    expect(doc.body.textContent).toContain('never expire');
    expect(doc.body.textContent).toContain('not refundable');
    expect(doc.body.textContent).toMatch(/Sales tax/);

    const [app, faq, ...rest] = jsonLd(doc);
    expect(rest).toHaveLength(0);
    expect(app).toMatchObject({ '@type': 'SoftwareApplication', name: 'Llyner Leads' });
    expect(app?.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Starter', price: '25.00', priceCurrency: 'USD' }),
        expect.objectContaining({ name: 'Growth', price: '100.00' }),
        expect.objectContaining({ name: 'Pro', price: '250.00' }),
      ]),
    );
    expect(faq).toMatchObject({ '@type': 'FAQPage' });
    expect((faq?.mainEntity as unknown[]).length).toBe(5);
  });

  test('SEO meta: title, description, canonical, Open Graph and Twitter tags', () => {
    const doc = parse(renderLandingPage(model()));
    const meta = (sel: string) => doc.querySelector(sel)?.getAttribute('content');
    expect(doc.title).toContain('Llyner Leads');
    expect(meta('meta[name="description"]')?.length).toBeGreaterThan(50);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://leads.example/',
    );
    expect(meta('meta[property="og:image"]')).toBe('https://leads.example/site/share.png');
    expect(meta('meta[property="og:url"]')).toBe('https://leads.example/');
    expect(meta('meta[name="twitter:card"]')).toBe('summary_large_image');
    expect(doc.querySelector('meta[name="robots"]')).toBeNull();
  });

  test('the sections of the approved mock are all there', () => {
    const doc = parse(renderLandingPage(model()));
    for (const id of ['top', 'signup', 'how', 'features', 'pricing', 'faq']) {
      expect(doc.getElementById(id), id).not.toBeNull();
    }
    expect(doc.querySelectorAll('#how .step')).toHaveLength(3);
    expect(doc.querySelectorAll('#features .feature')).toHaveLength(6);
    expect(doc.querySelectorAll('#faq .faq-item')).toHaveLength(5);
    expect(doc.body.textContent).toContain('Sweet Crumbs Bakery');
    expect(doc.body.textContent).toContain('Create your free account');
    const footerLinks = Array.from(doc.querySelectorAll('footer a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(footerLinks).toEqual(['/terms', '/privacy', '/acceptable-use', '/cookies']);
  });

  test('no video ID: no video section, no YouTube URL anywhere', () => {
    const html = renderLandingPage(model());
    expect(html).not.toMatch(/youtube|ytimg/i);
    expect(parse(html).getElementById('video')).toBeNull();
  });

  test('with a video ID: a thumbnail facade and a VideoObject, no iframe until clicked', () => {
    const html = renderLandingPage(
      model({
        settings: { gaMeasurementId: null, youtubeVideoId: 'dQw4w9WgXcQ', supportEmail: null },
      }),
    );
    const doc = parse(html);
    expect(doc.querySelector('iframe')).toBeNull();
    const facade = doc.querySelector('a[data-video-id]');
    expect(facade?.getAttribute('data-video-id')).toBe('dQw4w9WgXcQ');
    expect(facade?.querySelector('img')?.getAttribute('src')).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
    expect(jsonLd(doc).map((d) => d['@type'])).toContain('VideoObject');
  });

  test('an invalid video ID is ignored', () => {
    const html = renderLandingPage(
      model({
        settings: { gaMeasurementId: null, youtubeVideoId: '"><script>', supportEmail: null },
      }),
    );
    expect(html).not.toMatch(/youtube|<script>"/);
  });

  test('a signed-in visitor sees "Open the app" instead of the card', () => {
    const doc = parse(renderLandingPage(model({ signedIn: true })));
    expect(doc.querySelector('form')).toBeNull();
    const open = Array.from(doc.querySelectorAll('a')).filter(
      (a) => a.textContent === 'Open the app',
    );
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((a) => a.getAttribute('href') === '/app')).toBe(true);
    expect(doc.body.textContent).not.toContain('Enough for your first leads');
  });

  test('GA: the measurement ID is passed to the client script only when set', () => {
    expect(parse(renderLandingPage(model())).body.dataset.gaId).toBeUndefined();
    const doc = parse(
      renderLandingPage(
        model({
          settings: { gaMeasurementId: 'G-ABC1234', youtubeVideoId: null, supportEmail: null },
        }),
      ),
    );
    expect(doc.body.dataset.gaId).toBe('G-ABC1234');
  });

  test('no packs: the pricing section still explains the free credits', () => {
    const doc = parse(renderLandingPage(model({ packs: [] })));
    expect(doc.querySelectorAll('.pack')).toHaveLength(0);
    expect(doc.getElementById('pricing')?.textContent).toContain('50 free credits');
  });
});

describe('FR-35: the card', () => {
  test('Create account is the default tab; both forms post without JavaScript', () => {
    const doc = parse(renderLandingPage(model()));
    expect(doc.getElementById('tab-signup')?.getAttribute('aria-selected')).toBe('true');
    expect(doc.getElementById('panel-login')?.hasAttribute('hidden')).toBe(true);
    const signup = doc.querySelector<HTMLFormElement>('form[data-site-form="signup"]');
    expect(signup?.getAttribute('method')).toBe('post');
    expect(signup?.getAttribute('action')).toBe('/site/signup');
    expect(Array.from(signup?.querySelectorAll('input') ?? []).map((i) => i.name)).toEqual([
      'businessName',
      'name',
      'email',
      'password',
    ]);
    expect(doc.querySelector('form[data-site-form="login"]')?.getAttribute('action')).toBe(
      '/site/login',
    );
    expect(doc.getElementById('panel-signup')?.textContent).toContain(
      'By signing up you agree to the Terms of Service and Privacy Policy',
    );
  });

  test('field errors render inline with the typed values, never the password', () => {
    const card = emptyCard('signup');
    card.signup.values = { businessName: 'Sweet <Supply>', name: 'Sam', email: 'sam@x.test' };
    card.signup.errors = { password: 'Use at least 10 characters (up to 128).' };
    const doc = parse(renderLandingPage(model({ card, noindex: true })));
    const password = doc.getElementById('signup-password') as HTMLInputElement;
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(password.getAttribute('value')).toBeNull();
    expect(doc.getElementById('signup-password-error')?.textContent).toBe(
      'Use at least 10 characters (up to 128).',
    );
    expect((doc.getElementById('signup-businessName') as HTMLInputElement).value).toBe(
      'Sweet <Supply>',
    );
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex');
  });

  test('email taken: the Log in tab is shown with the email filled in', () => {
    const card = emptyCard('login');
    card.login.values = { email: 'sam@x.test' };
    card.login.message = 'You already have an account. Log in instead.';
    const doc = parse(renderLandingPage(model({ card })));
    expect(doc.getElementById('tab-login')?.getAttribute('aria-selected')).toBe('true');
    expect(doc.getElementById('panel-signup')?.hasAttribute('hidden')).toBe(true);
    expect((doc.getElementById('login-email') as HTMLInputElement).value).toBe('sam@x.test');
    expect(doc.querySelector('[data-form-error="login"]')?.textContent).toBe(
      'You already have an account. Log in instead.',
    );
  });
});

describe('FR-33: legal page markup', () => {
  test('renders the draft with its title, date, nav and canonical URL', () => {
    const html = renderLegalPage({
      siteUrl: 'https://leads.example',
      settings: { gaMeasurementId: null, youtubeVideoId: null, supportEmail: 'help@leads.example' },
      signedIn: false,
      year: 2026,
      clientScriptSrc: '/site/client.js?v=abc',
      slug: 'terms',
      markdown: terms,
    });
    const doc = parse(html);
    expect(doc.querySelector('h1')?.textContent).toBe('Terms of Service');
    expect(doc.title).toBe('Terms of Service · Llyner Leads');
    expect(doc.querySelector('.draft')?.textContent).toBe('Draft for founder review');
    expect(doc.querySelector('time')?.textContent).toBe('Last updated Nov 19, 2026');
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://leads.example/terms',
    );
    expect(doc.querySelector('.legal-nav a[aria-current="page"]')?.getAttribute('href')).toBe(
      '/terms',
    );
    expect(doc.querySelector('main')?.textContent).toContain('Credits never expire.');
    expect(doc.querySelector('main a[href="mailto:help@leads.example"]')).not.toBeNull();
    expect(doc.querySelector('main')?.textContent).not.toContain('[SUPPORT EMAIL]');
    expect(doc.querySelector('footer a[href="mailto:help@leads.example"]')).not.toBeNull();
  });
});
