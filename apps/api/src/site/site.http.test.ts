import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PASSWORD } from '../modules/identity/test/factories.js';
import { FakeTotp } from '../modules/identity/test/fakes.js';
import { buildSiteApp, SITE_URL, SiteWorld } from './test/site-test-app.js';

let world: SiteWorld;
let app: FastifyInstance;

beforeEach(async () => {
  world = new SiteWorld();
  app = await buildSiteApp(world);
});
afterEach(() => app.close());

let n = 0;
let ipSeq = 0;
function nextIp(): string {
  ipSeq += 1;
  return `10.1.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`;
}

function signupForm(overrides: Record<string, string> = {}): Record<string, string> {
  n += 1;
  return {
    businessName: `Sweet Supply ${n}`,
    name: 'Sam',
    email: `sam${n}@example.com`,
    password: PASSWORD,
    ...overrides,
  };
}

interface PostOptions {
  origin?: string | null;
  json?: boolean;
  ip?: string;
  cookie?: string;
}

function post(url: string, form: Record<string, string>, opts: PostOptions = {}) {
  const origin = opts.origin === undefined ? SITE_URL : opts.origin;
  return app.inject({
    method: 'POST',
    url,
    remoteAddress: opts.ip ?? nextIp(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(origin ? { origin } : {}),
      ...(opts.json ? { accept: 'application/json' } : { accept: 'text/html' }),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    payload: new URLSearchParams(form).toString(),
  });
}

function get(url: string, cookie?: string) {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
}

function sessionCookie(res: LightMyRequestResponse): string {
  const sid = res.cookies.find((c) => c.name === 'sid');
  if (!sid) throw new Error('no session cookie');
  return `sid=${sid.value}`;
}

function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1] ?? '') as Record<string, unknown>,
  );
}

const headline = 'Find the businesses most likely to buy what you sell.';

describe('FR-34: GET / for a crawler without JavaScript', () => {
  test('HTML with the headline, the live pack prices and parseable JSON-LD', async () => {
    const res = await get('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.body).toContain(headline);
    for (const price of ['$25', '$100', '$250']) expect(res.body).toContain(price);
    const ld = jsonLd(res.body);
    expect(ld.map((d) => d['@type'])).toEqual(['SoftwareApplication', 'FAQPage']);
    const offers = ld[0]?.offers as { name: string; price: string }[];
    expect(offers.filter((o) => o.name !== 'Free trial').map((o) => [o.name, o.price])).toEqual([
      ['Starter', '25.00'],
      ['Growth', '100.00'],
      ['Pro', '250.00'],
    ]);
    expect(res.body).toContain(`<link rel="canonical" href="${SITE_URL}/"/>`);
  });

  test('prices come from the packs port: a new price shows once the 5-minute cache expires', async () => {
    await get('/');
    world.packs = [{ id: 'pack-starter', name: 'Starter', credits: 2_500, priceCents: 1_900 }];
    expect((await get('/')).body).not.toContain('$19');
    world.identity.clock.set(new Date(world.identity.clock.now().getTime() + 4 * 60_000));
    expect((await get('/')).body).not.toContain('$19');
    world.identity.clock.set(new Date(world.identity.clock.now().getTime() + 61_000));
    expect((await get('/')).body).toContain('$19');
  });

  test('anonymous pages are served from the cache', async () => {
    await get('/');
    await get('/');
    await get('/?utm_source=ad');
    expect(world.packReads).toBe(1);
    const res = await get('/');
    expect(res.headers['cache-control']).toBe('public, max-age=0, s-maxage=300');
    expect(res.headers.vary).toBe('Cookie');
  });

  test('no video ID: no video section and nothing from YouTube', async () => {
    const res = await get('/');
    expect(res.body).not.toMatch(/youtube|ytimg/i);
  });

  test('a video ID adds the facade and a VideoObject, but no iframe', async () => {
    world.settings.youtubeVideoId = 'dQw4w9WgXcQ';
    const res = await get('/');
    expect(res.body).toContain('data-video-id="dQw4w9WgXcQ"');
    expect(res.body).not.toContain('<iframe');
    expect(jsonLd(res.body).map((d) => d['@type'])).toContain('VideoObject');
  });

  test('security headers: CSP for fonts, YouTube, and Google Analytics only when configured', async () => {
    const plain = await get('/');
    const csp = String(plain.headers['content-security-policy']);
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp).toContain('frame-src https://www.youtube-nocookie.com');
    expect(csp).toContain('https://i.ytimg.com');
    expect(csp).not.toContain('googletagmanager');
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(plain.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(plain.headers['x-content-type-options']).toBe('nosniff');

    world.settings.gaMeasurementId = 'G-TEST1234';
    const fresh = await buildSiteApp(world);
    const withGa = await fresh.inject({ method: 'GET', url: '/' });
    expect(String(withGa.headers['content-security-policy'])).toContain(
      "script-src 'self' https://www.googletagmanager.com",
    );
    expect(withGa.body).toContain('data-ga-id="G-TEST1234"');
    await fresh.close();
  });

  test('HTTPS deployments upgrade insecure requests', async () => {
    const secure = await buildSiteApp(world, { secureCookies: true });
    const res = await secure.inject({ method: 'GET', url: '/' });
    expect(String(res.headers['content-security-policy'])).toContain('upgrade-insecure-requests');
    await secure.close();
  });

  test('a signed-in visitor sees "Open the app" instead of the card, not cached', async () => {
    const owner = await world.useCases.signUp.execute({
      businessName: 'Signed In Co',
      name: 'Sam',
      email: 'signed-in@example.com',
      password: PASSWORD,
      ip: nextIp(),
    });
    const res = await get('/', `sid=${owner.sessionToken}`);
    expect(res.body).toContain('Open the app');
    expect(res.body).not.toContain('action="/site/signup"');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    // The anonymous variant is unaffected.
    expect((await get('/')).body).toContain('action="/site/signup"');
  });

  test('?tab=login opens the card on Log in', async () => {
    const res = await get('/?tab=login');
    expect(res.body).toMatch(/id="tab-login"[^>]*aria-selected="true"/);
  });
});

describe('FR-34: sitemap, robots, share image, client script', () => {
  test('robots.txt disallows /app and /api and points to the sitemap', async () => {
    const res = await get('/robots.txt');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toMatch(/^Disallow: \/app$/m);
    expect(res.body).toMatch(/^Disallow: \/api$/m);
    expect(res.body).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });

  test('sitemap.xml lists the landing page and the four legal pages', async () => {
    const res = await get('/sitemap.xml');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    const locs = [...res.body.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      `${SITE_URL}/`,
      `${SITE_URL}/terms`,
      `${SITE_URL}/privacy`,
      `${SITE_URL}/acceptable-use`,
      `${SITE_URL}/cookies`,
    ]);
    expect(res.body).toContain('<lastmod>2026-11-19</lastmod>');
  });

  test('the share image is a 1200×630 PNG', async () => {
    const res = await get('/site/share.png');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    const png = res.rawPayload;
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  test('the client script is served with a long cache for the versioned URL', async () => {
    const page = await get('/');
    const src = /<script src="(\/site\/client\.js\?v=[0-9a-f]+)" defer=""><\/script>/.exec(
      page.body,
    )?.[1];
    expect(src).toBeDefined();
    const res = await get(src ?? '');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.body).toContain('data-site-form');
  });

  test('the icon is an SVG', async () => {
    const res = await get('/site/icon.svg');
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toContain('<svg');
  });
});

describe('FR-33: legal pages', () => {
  test.each(['/terms', '/privacy', '/acceptable-use', '/cookies'])(
    '%s renders without logging in',
    async (path) => {
      const res = await get(path);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<h1>');
      expect(res.body).toContain('Last updated Nov 19, 2026');
      expect(res.body).toContain(`<link rel="canonical" href="${SITE_URL}${path}"/>`);
    },
  );

  test('the Terms state that credits never expire and are not refundable', async () => {
    const res = await get('/terms');
    expect(res.body).toContain('Credits never expire.');
    expect(res.body).toContain('Credits are not refundable.');
  });

  test('the support email from Platform settings fills the placeholder', async () => {
    world.settings.supportEmail = 'help@llyner.example';
    const res = await get('/privacy');
    expect(res.body).toContain('href="mailto:help@llyner.example"');
    expect(res.body).not.toContain('[SUPPORT EMAIL]');
  });
});

describe('FR-35: no-JS sign-up (POST /site/signup)', () => {
  test('valid details: 303 to /app, signed in, business_signed_up with source landing', async () => {
    const res = await post('/site/signup', signupForm({ email: 'Sam.New@Example.com' }));
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/app');
    const cookie = res.cookies.find((c) => c.name === 'sid');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(world.identity.store.members.size).toBe(1);
    expect(world.identity.analytics.events).toEqual([
      expect.objectContaining({
        name: 'business_signed_up',
        properties: expect.objectContaining({ source: 'landing' }) as unknown,
      }),
    ]);
    expect(world.identity.email.sent).toHaveLength(1);
    // The new session is a signed-in visitor.
    expect((await get('/', sessionCookie(res))).body).toContain('Open the app');
  });

  test('a short password re-renders the card with the error inline and the values kept', async () => {
    const res = await post(
      '/site/signup',
      signupForm({ businessName: 'Sweet <Co>', password: 'short' }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain(headline);
    expect(res.body).toMatch(/id="signup-password"[^>]*aria-invalid="true"/);
    expect(res.body).toContain('Use at least 10 characters (up to 128).');
    expect(res.body).toContain('value="Sweet &lt;Co&gt;"');
    expect(res.body).not.toContain('value="short"');
    expect(res.body).toContain('<meta name="robots" content="noindex"/>');
    expect(world.identity.store.members.size).toBe(0);
  });

  test('a common password gets the domain rule message', async () => {
    const res = await post('/site/signup', signupForm({ password: 'password123' }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('too common');
  });

  test('email taken: the Log in tab with the email filled and the message', async () => {
    const form = signupForm();
    await post('/site/signup', form);
    const res = await post('/site/signup', { ...form, email: form.email?.toUpperCase() ?? '' });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatch(/id="tab-login"[^>]*aria-selected="true"/);
    expect(res.body).toMatch(/id="panel-signup"[^>]*hidden=""/);
    expect(res.body).toMatch(new RegExp(`id="login-email"[^>]*value="${form.email}"`));
    expect(res.body).toContain('You already have an account. Log in instead.');
    expect(world.identity.store.members.size).toBe(1);
  });

  test('a post from another origin is refused and nothing is created', async () => {
    const res = await post('/site/signup', signupForm(), { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
    expect(world.identity.store.members.size).toBe(0);
    const none = await post('/site/signup', signupForm(), { origin: null });
    expect(none.statusCode).toBe(403);
  });

  test('a browser that sends Origin: null falls back to the Referer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/site/signup',
      remoteAddress: nextIp(),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'null',
        referer: `${SITE_URL}/`,
      },
      payload: new URLSearchParams(signupForm()).toString(),
    });
    expect(res.statusCode).toBe(303);
  });

  test("identity's limit: the 6th sign-up from one IP in an hour gets 429 in the card", async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      expect((await post('/site/signup', signupForm(), { ip })).statusCode).toBe(303);
    }
    const res = await post('/site/signup', signupForm(), { ip });
    expect(res.statusCode).toBe(429);
    expect(res.body).toContain('Too many sign-up attempts from your network.');
  });

  test('the forms are rate-limited per IP on top of identity (route limit)', async () => {
    const limited = await buildSiteApp(world, { formRateLimitPerMinute: 2 });
    const send = () =>
      limited.inject({
        method: 'POST',
        url: '/site/login',
        remoteAddress: '10.9.9.9',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE_URL },
        payload: 'email=nobody%40example.com&password=whatever-pass',
      });
    expect((await send()).statusCode).toBe(401);
    expect((await send()).statusCode).toBe(401);
    const res = await send();
    expect(res.statusCode).toBe(429);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('Too many attempts, try again in 15 minutes.');
    await limited.close();
  });

  test('with JavaScript (Accept: application/json) the same post answers JSON', async () => {
    const ok = await post('/site/signup', signupForm(), { json: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ redirect: '/app' });
    expect(ok.cookies.find((c) => c.name === 'sid')).toBeDefined();

    const bad = await post('/site/signup', signupForm({ email: 'not-an-email' }), { json: true });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', fields: { email: 'Enter a valid email address.' } },
      tab: 'signup',
    });

    const form = signupForm();
    await post('/site/signup', form, { json: true });
    const taken = await post('/site/signup', form, { json: true });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({
      error: { code: 'EMAIL_TAKEN', message: 'You already have an account. Log in instead.' },
      tab: 'login',
      email: form.email,
    });
  });

  test('GET /site/signup after a refresh goes back to the card', async () => {
    const res = await get('/site/signup');
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/#signup');
  });
});

describe('FR-35: no-JS log-in (POST /site/login)', () => {
  test('an Owner lands on /app signed in', async () => {
    const form = signupForm();
    await post('/site/signup', form);
    const res = await post('/site/login', { email: form.email ?? '', password: PASSWORD });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/app');
    expect((await get('/', sessionCookie(res))).body).toContain('Open the app');
  });

  test('Staff continue to the two-factor step', async () => {
    const form = signupForm();
    await post('/site/signup', form);
    await world.useCases.runStaffCommand.execute({ command: 'grant', email: form.email ?? '' });
    const res = await post('/site/login', { email: form.email ?? '', password: PASSWORD });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/app/login/two-factor');
    expect(FakeTotp.validCode).toBeDefined();
  });

  test('wrong password: 401 with the message in the Log in tab and the email kept', async () => {
    const res = await post('/site/login', { email: 'sam@example.com', password: 'wrong-password' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatch(/id="tab-login"[^>]*aria-selected="true"/);
    expect(res.body).toContain('Wrong email or password.');
    expect(res.body).toMatch(/id="login-email"[^>]*value="sam@example.com"/);
  });

  test('an empty form shows field errors', async () => {
    const res = await post('/site/login', { email: '', password: '' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Enter a valid email address.');
    expect(res.body).toContain('Enter your password.');
  });

  test("identity's limit: after 5 wrong passwords, 429", async () => {
    const form = signupForm();
    await post('/site/signup', form);
    for (let i = 0; i < 5; i++) {
      await post('/site/login', { email: form.email ?? '', password: 'wrong-password' });
    }
    const res = await post('/site/login', { email: form.email ?? '', password: PASSWORD });
    expect(res.statusCode).toBe(429);
    expect(res.body).toContain('Too many attempts, try again in 15 minutes.');
  });

  test('Origin check', async () => {
    const res = await post(
      '/site/login',
      { email: 'a@b.co', password: 'x' },
      { origin: 'https://evil.example' },
    );
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('This form must be sent from the Llyner Leads site.');
  });
});

describe('placeholder without collaborators', () => {
  test('/ still answers when the site is not wired (module tests)', async () => {
    const Fastify = (await import('fastify')).default;
    const { siteRoutes } = await import('./site.routes.js');
    const bare = Fastify({ logger: false });
    await bare.register(siteRoutes);
    const res = await bare.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Llyner Leads');
    await bare.close();
  });
});
