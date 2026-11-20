import { createHash } from 'node:crypto';
import { siteLogin, siteSignup } from '@app/contracts/site';
import type {
  FastifyError,
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { setSessionCookie } from '../modules/identity/index.js';
import { clientIp } from '../shared/http/client-ip.js';
import {
  emptyCard,
  legalSlugs,
  parseLegalDocument,
  renderLandingPage,
  renderLegalPage,
  siteClientScript,
  siteCopy,
  type CardState,
  type CardTab,
  type LegalSlug,
  type PageContext,
} from '../../../web/src/site/index.js';
import {
  formFailure,
  loginFailure,
  loginInvalid,
  parseForm,
  signupFailure,
  signupInvalid,
  type FormFailure,
} from './forms.js';
import { PAGE_CACHE_TTL_MS, PageCache } from './page-cache.js';
import type { SiteDeps } from './ports.js';
import { setPageCaching, setPageSecurityHeaders, type PageCaching } from './security-headers.js';
import { robotsTxt, sitemapXml } from './seo-files.js';
import { iconSvg, shareImagePath, shareImagePng } from './share-image.js';

export type { SiteDeps } from './ports.js';

const CLIENT_VERSION = createHash('sha256').update(siteClientScript).digest('hex').slice(0, 12);
const CLIENT_SRC = `/site/client.js?v=${CLIENT_VERSION}`;
const HTML = 'text/html; charset=utf-8';
const noRateLimit = { rateLimit: false } as const;

interface RenderedPage {
  html: string;
  /** Whether the page carries the GA measurement ID (the CSP must then allow Google's tag). */
  analytics: boolean;
}

/** `/site/*` forms must come from the site itself (ADR 0004): Origin, or Referer without one. */
function fromSite(req: FastifyRequest, siteOrigin: string): boolean {
  const origin = req.headers.origin;
  const source = origin && origin !== 'null' ? origin : req.headers.referer;
  if (!source) return false;
  try {
    return new URL(source).origin === siteOrigin;
  } catch {
    return false;
  }
}

function wantsJson(req: FastifyRequest): boolean {
  return (req.headers.accept ?? '').includes('application/json');
}

/**
 * The public site (FR-33 to FR-35, ADR 0016): the landing page, the legal pages, sitemap.xml,
 * robots.txt, the share image, the client script and the card's form posts. Registered at the
 * root, outside the /api scope.
 */
function registerSite(app: FastifyInstance, deps: SiteDeps): void {
  const siteUrl = deps.siteUrl.replace(/\/+$/, '');
  const siteOrigin = new URL(siteUrl).origin;
  const cache = new PageCache<RenderedPage>(deps.clock, deps.cacheTtlMs ?? PAGE_CACHE_TTL_MS);
  const formLimit = {
    rateLimit: { max: deps.formRateLimitPerMinute ?? 20, timeWindow: '1 minute' },
  };

  // The card's forms post `application/x-www-form-urlencoded` (scoped to this plugin).
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 16_384 },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    },
  );

  async function pageContext(req: FastifyRequest, noindex = false): Promise<PageContext> {
    const [analytics, landing, support] = await Promise.all([
      deps.settings.analytics(),
      deps.settings.landing(),
      deps.settings.support(),
    ]);
    return {
      siteUrl,
      settings: {
        gaMeasurementId: analytics.gaMeasurementId,
        youtubeVideoId: landing.youtubeVideoId,
        supportEmail: support.supportEmail,
      },
      signedIn: req.actor !== null,
      year: deps.clock.now().getUTCFullYear(),
      clientScriptSrc: CLIENT_SRC,
      noindex,
    };
  }

  async function renderLanding(req: FastifyRequest, card: CardState, noindex = false) {
    const [ctx, packs] = await Promise.all([pageContext(req, noindex), deps.packs.activePacks()]);
    return {
      html: renderLandingPage({ ...ctx, packs, card }),
      analytics: ctx.settings.gaMeasurementId !== null,
    };
  }

  async function renderLegal(req: FastifyRequest, slug: LegalSlug) {
    const [ctx, markdown] = await Promise.all([pageContext(req), deps.legal.read(slug)]);
    return {
      html: renderLegalPage({ ...ctx, slug, markdown }),
      analytics: ctx.settings.gaMeasurementId !== null,
    };
  }

  function sendPage(reply: FastifyReply, page: RenderedPage, caching: PageCaching, status = 200) {
    setPageSecurityHeaders(reply, { analytics: page.analytics, secure: deps.secureCookies });
    setPageCaching(reply, caching);
    return reply.status(status).type(HTML).send(page.html);
  }

  /** Anonymous pages come from the 5-minute cache; the signed-in variant is rendered fresh. */
  async function servePage(
    req: FastifyRequest,
    reply: FastifyReply,
    key: string,
    render: () => Promise<RenderedPage>,
  ) {
    if (req.actor) return sendPage(reply, await render(), 'private');
    return sendPage(reply, await cache.getOrCreate(key, render), 'public');
  }

  app.get('/', { config: noRateLimit }, (req, reply) => {
    const { tab } = req.query as { tab?: string };
    const selected: CardTab = tab === 'login' ? 'login' : 'signup';
    return servePage(req, reply, `landing:${selected}`, () =>
      renderLanding(req, emptyCard(selected)),
    );
  });

  for (const slug of legalSlugs) {
    app.get(`/${slug}`, { config: noRateLimit }, (req, reply) =>
      servePage(req, reply, `legal:${slug}`, () => renderLegal(req, slug)),
    );
  }

  app.get('/robots.txt', { config: noRateLimit }, (_req, reply) =>
    reply
      .type('text/plain; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .send(robotsTxt(siteUrl)),
  );

  app.get('/sitemap.xml', { config: noRateLimit }, async (_req, reply) => {
    const updated: Record<string, string> = {};
    for (const slug of legalSlugs) {
      const doc = parseLegalDocument(await deps.legal.read(slug), slug);
      if (doc.lastUpdated) updated[`/${slug}`] = doc.lastUpdated;
    }
    return reply
      .type('application/xml; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .send(sitemapXml(siteUrl, updated));
  });

  app.get('/site/client.js', { config: noRateLimit }, (req, reply) => {
    const { v } = req.query as { v?: string };
    const immutable = v === CLIENT_VERSION;
    return reply
      .type('text/javascript; charset=utf-8')
      .header(
        'cache-control',
        immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      )
      .send(siteClientScript);
  });

  app.get(shareImagePath, { config: noRateLimit }, (_req, reply) =>
    reply.type('image/png').header('cache-control', 'public, max-age=86400').send(shareImagePng()),
  );

  app.get('/site/icon.svg', { config: noRateLimit }, (_req, reply) =>
    reply.type('image/svg+xml').header('cache-control', 'public, max-age=86400').send(iconSvg()),
  );

  // A refresh after a failed post lands on these URLs: send the visitor back to the card.
  app.get('/site/signup', { config: noRateLimit }, (_req, reply) =>
    reply.redirect('/#signup', 303),
  );
  app.get('/site/login', { config: noRateLimit }, (_req, reply) =>
    reply.redirect('/?tab=login#signup', 303),
  );

  /** A failed post: the card again with the errors (no JS), or the errors as JSON (with JS). */
  async function fail(req: FastifyRequest, reply: FastifyReply, failure: FormFailure) {
    if (wantsJson(req)) {
      setPageCaching(reply, 'none');
      return reply.status(failure.status).send({
        error: {
          code: failure.code,
          message: failure.message,
          ...(Object.keys(failure.fields).length ? { fields: failure.fields } : {}),
        },
        tab: failure.card.tab,
        ...(failure.card.tab === 'login' && failure.card.login.values.email
          ? { email: failure.card.login.values.email }
          : {}),
      });
    }
    return sendPage(reply, await renderLanding(req, failure.card, true), 'none', failure.status);
  }

  function succeed(req: FastifyRequest, reply: FastifyReply, to: string) {
    setPageCaching(reply, 'none');
    if (wantsJson(req)) return reply.status(200).send({ redirect: to });
    return reply.redirect(to, 303);
  }

  // FR-35: no-JS sign-up through identity's FR-1 use case, `business_signed_up` source landing.
  app.post('/site/signup', { config: formLimit }, async (req, reply) => {
    const form = parseForm(req.body);
    const values = {
      businessName: form.businessName ?? '',
      name: form.name ?? '',
      email: form.email ?? '',
    };
    if (!fromSite(req, siteOrigin)) {
      return fail(
        req,
        reply,
        formFailure('signup', 403, 'FORBIDDEN', siteCopy.errors.forbidden, values),
      );
    }
    const parsed = siteSignup.body.safeParse(form);
    if (!parsed.success) {
      return fail(req, reply, signupInvalid(parsed.error, values));
    }
    values.email = parsed.data.email;
    try {
      const result = await deps.identity.signUp.execute({
        ...parsed.data,
        ip: clientIp(req),
        source: 'landing',
      });
      setSessionCookie(reply, result.sessionToken, { secure: deps.secureCookies });
      return succeed(req, reply, '/app');
    } catch (err) {
      const failure = signupFailure(err, values);
      if (!failure) throw err;
      return fail(req, reply, failure);
    }
  });

  // FR-35: no-JS log-in through identity's FR-3 use case; Staff continue to two-factor.
  app.post('/site/login', { config: formLimit }, async (req, reply) => {
    const form = parseForm(req.body);
    const values = { email: form.email ?? '' };
    if (!fromSite(req, siteOrigin)) {
      return fail(
        req,
        reply,
        formFailure('login', 403, 'FORBIDDEN', siteCopy.errors.forbidden, values),
      );
    }
    const parsed = siteLogin.body.safeParse(form);
    if (!parsed.success) {
      return fail(req, reply, loginInvalid(parsed.error, values));
    }
    values.email = parsed.data.email;
    try {
      const { me, sessionToken } = await deps.identity.logIn.execute({
        ...parsed.data,
        ip: clientIp(req),
      });
      setSessionCookie(reply, sessionToken, { secure: deps.secureCookies });
      const twoFactorPending = me.twoFactor.required && !me.twoFactor.passed;
      return succeed(req, reply, twoFactorPending ? '/app/login/two-factor' : '/app');
    } catch (err) {
      const failure = loginFailure(err, values);
      if (!failure) throw err;
      return fail(req, reply, failure);
    }
  });

  // @fastify/rate-limit's 429 on the forms: show it in the card like identity's own limits.
  app.setErrorHandler(async (error: FastifyError, req, reply) => {
    const path = req.url.split('?')[0];
    if (error.statusCode === 429 && (path === '/site/signup' || path === '/site/login')) {
      const tab: CardTab = path === '/site/login' ? 'login' : 'signup';
      const form = parseForm(req.body);
      const message =
        tab === 'login' ? siteCopy.errors.loginTooMany : siteCopy.errors.signupTooMany;
      return fail(req, reply, formFailure(tab, 429, 'TOO_MANY_REQUESTS', message, form));
    }
    throw error;
  });
}

const placeholder = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Llyner Leads</title></head><body><main><h1>Llyner Leads</h1><p><a href="/app/">Open the app</a></p></main></body></html>`;

export interface SiteRoutesOptions {
  /** The site's collaborators; without them (module tests) `/` serves a bare placeholder. */
  site?: SiteDeps;
}

/** `app.register(siteRoutes, { site })` at the root of buildApp, before the /api scope. */
export const siteRoutes: FastifyPluginAsync<SiteRoutesOptions> = async (app, opts) => {
  await Promise.resolve();
  if (opts.site) {
    registerSite(app, opts.site);
    return;
  }
  app.get('/', { config: noRateLimit }, (_req, reply) => reply.type(HTML).send(placeholder));
};
