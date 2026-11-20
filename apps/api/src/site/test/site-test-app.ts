import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { createIdentityUseCases } from '../../modules/identity/application/use-cases.js';
import { actorResolverFrom } from '../../modules/identity/index.js';
import { fakeIdentity, type FakeIdentity } from '../../modules/identity/test/fakes.js';
import { registerActor } from '../../shared/http/actor-plugin.js';
import {
  clientIp,
  DEFAULT_TRUST_PROXY_HOPS,
  registerClientIp,
  trustHops,
} from '../../shared/http/client-ip.js';
import { registerErrorHandling } from '../../shared/http/error-handler.js';
import type { SitePack } from '../../../../web/src/site/index.js';
import { fileLegalContent } from '../legal-content.js';
import type { SiteDeps } from '../ports.js';
import { siteRoutes } from '../site.routes.js';

export const SITE_URL = 'http://localhost:5173';

export const seededPacks: SitePack[] = [
  { id: 'pack-starter', name: 'Starter', credits: 2_500, priceCents: 2_500 },
  { id: 'pack-growth', name: 'Growth', credits: 11_000, priceCents: 10_000 },
  { id: 'pack-pro', name: 'Pro', credits: 30_000, priceCents: 25_000 },
];

/** The site's collaborators as fakes: identity's real use cases on its in-memory fakes. */
export class SiteWorld {
  readonly identity: FakeIdentity = fakeIdentity();
  readonly useCases = createIdentityUseCases(this.identity);
  packs: SitePack[] = [...seededPacks];
  packReads = 0;
  settings = {
    gaMeasurementId: null as string | null,
    youtubeVideoId: null as string | null,
    supportEmail: null as string | null,
  };

  deps(overrides: Partial<SiteDeps> = {}): SiteDeps {
    return {
      siteUrl: SITE_URL,
      secureCookies: false,
      clock: this.identity.clock,
      packs: {
        activePacks: () => {
          this.packReads += 1;
          return Promise.resolve(this.packs);
        },
      },
      settings: {
        analytics: () => Promise.resolve({ gaMeasurementId: this.settings.gaMeasurementId }),
        landing: () => Promise.resolve({ youtubeVideoId: this.settings.youtubeVideoId }),
        support: () => Promise.resolve({ supportEmail: this.settings.supportEmail }),
      },
      identity: this.useCases,
      legal: fileLegalContent(),
      ...overrides,
    };
  }
}

/**
 * The same root setup as buildApp (error handling, Actor from the session cookie, helmet,
 * cookies, the global rate limit) with the site registered and no /api modules.
 */
export async function buildSiteApp(
  world: SiteWorld,
  overrides: Partial<SiteDeps> = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: trustHops(DEFAULT_TRUST_PROXY_HOPS) });
  registerClientIp(app);
  registerErrorHandling(app);
  registerActor(app, actorResolverFrom(world.identity));
  await app.register(helmet);
  await app.register(cookie, { secret: 'site-test-secret-site-test-secret' });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: clientIp,
  });
  await app.register(siteRoutes, { site: world.deps(overrides) });
  await app.ready();
  return app;
}
