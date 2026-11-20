import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AnalyticsTracker } from '../../shared/application/analytics-tracker.js';
import type { EmailSender } from '../../shared/application/email-sender.js';
import type { Actor } from '../../shared/domain/actor.js';
import type { Clock } from '../../shared/domain/clock.js';
import type { IdGenerator } from '../../shared/domain/id-generator.js';
import type { Database } from '../../shared/infrastructure/db/database.js';
import type {
  AuditRecorder,
  IdentityLogger,
  IdentityServices,
  PasswordHasher,
  SecretCipher,
  TokenService,
  TotpService,
} from './application/ports.js';
import { identityQueriesFrom, type IdentityQueries } from './application/queries.js';
import { ResolveActor } from './application/resolve-actor.js';
import type { StaffCommand } from './application/staff-commands.js';
import { createIdentityUseCases, type IdentityUseCases } from './application/use-cases.js';
import { Business } from './domain/business.js';
import { Member } from './domain/member.js';
import { registerOriginCheck } from './http/origin-check.js';
import { identityRoutes } from './http/identity.routes.js';
import { readSessionToken, type CookieOptions } from './http/session-cookie.js';
import { kyselyIdentityServices } from './infrastructure/kysely-identity.js';
import { kyselyIdentityRepos } from './infrastructure/kysely-repositories.js';
import { BcryptPasswordHasher, CryptoTokenService } from './infrastructure/security-adapters.js';

export type { AuditRecorder, SecretCipher } from './application/ports.js';
export type { BusinessListItem, BusinessListQuery } from './application/ports.js';
export type { BusinessSummary, IdentityQueries, OwnerContact } from './application/queries.js';
export type { SignedIn } from './application/session-context.js';
export type { IdentityUseCases } from './application/use-cases.js';
export { assertStaff } from './application/acting-as.js';
export { originCheck, registerOriginCheck } from './http/origin-check.js';
export {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
  SESSION_COOKIE,
} from './http/session-cookie.js';

/** What main.ts provides beyond the shared AppDeps (clock, ids, analytics, email). */
export interface IdentityConfig {
  db: Database;
  /** platform's SecretBox (AES-256-GCM): encrypts the Staff TOTP secret (ADR 0012). */
  cipher: SecretCipher;
  /** platform's Audit log (FR-7). */
  audit: AuditRecorder;
  /** APP_URL: email links and the Origin check. */
  appUrl: string;
  /** `Secure` session cookie: true in production. */
  secureCookies: boolean;
}

export interface IdentityDeps extends IdentityConfig {
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  email: EmailSender;
  logger?: IdentityLogger;
  /** Overrides for tests (e.g. a cheap bcrypt cost). */
  passwords?: PasswordHasher;
  tokens?: TokenService;
  totp?: TotpService;
}

/** Structurally an AppModule (app.ts), registered under /api. */
export interface IdentityAppModule {
  readonly name: string;
  register(app: FastifyInstance, deps: object): void | Promise<void>;
}

/** Builds the module's HTTP routes on any IdentityServices (Kysely in production, fakes in tests). */
export function identityModuleFrom(
  services: IdentityServices,
  cookies: CookieOptions,
): IdentityAppModule {
  return {
    name: 'identity',
    register(app) {
      registerOriginCheck(app, { appUrl: services.appUrl });
      identityRoutes(app, createIdentityUseCases(services), cookies);
    },
  };
}

function servicesFor(deps: IdentityDeps, logger: IdentityLogger): IdentityServices {
  return kyselyIdentityServices({ ...deps, logger: deps.logger ?? logger });
}

/** identity on MySQL: routes for FR-1 to FR-6 (Origin check included for its own routes). */
export function createIdentityModule(deps: IdentityDeps): IdentityAppModule {
  return {
    name: 'identity',
    register(app) {
      const services = servicesFor(deps, app.log);
      return identityModuleFrom(services, { secure: deps.secureCookies }).register(app, deps);
    },
  };
}

/**
 * The module as app.ts lists it: it reads `deps.identity` (IdentityConfig) next to the shared
 * AppDeps. main.ts must provide it; there is no identity without a database.
 */
export const identityModule: IdentityAppModule = {
  name: 'identity',
  register(app, deps) {
    const shared = deps as Partial<Omit<IdentityDeps, keyof IdentityConfig>> & {
      identity?: IdentityConfig;
    };
    const { identity, clock, ids, analytics, email } = shared;
    if (!identity || !clock || !ids || !analytics || !email) {
      throw new Error('identity module: buildApp needs deps.identity (IdentityConfig)');
    }
    return createIdentityModule({ ...identity, clock, ids, analytics, email }).register(app, deps);
  },
};

/** Session cookie → Actor, for buildApp's `deps.resolveActor` (ADR 0004, ADR 0014, FR-5, FR-6). */
export function actorResolverFrom(
  services: Pick<IdentityServices, 'repos' | 'tokens' | 'clock'>,
): (req: FastifyRequest) => Promise<Actor | null> {
  const resolve = new ResolveActor(services);
  return (req) => resolve.execute({ token: readSessionToken(req), path: req.url });
}

export function createActorResolver(deps: {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
}): (req: FastifyRequest) => Promise<Actor | null> {
  return actorResolverFrom({
    repos: kyselyIdentityRepos(deps.db, () => deps.ids.next()),
    tokens: new CryptoTokenService(),
    clock: deps.clock,
  });
}

/** identity's public queries for other modules (reporting, billing, profile…). */
export function createIdentityQueries(deps: {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
}): IdentityQueries {
  const services = kyselyIdentityServices({
    ...deps,
    analytics: { track: () => Promise.resolve() },
    email: { send: () => Promise.reject(new Error('identity queries send no email')) },
    cipher: {
      encrypt: () => {
        throw new Error('identity queries need no cipher');
      },
      decrypt: () => {
        throw new Error('identity queries need no cipher');
      },
    },
    audit: { record: () => Promise.resolve() },
    logger: { warn: () => undefined },
    appUrl: 'http://localhost',
  });
  return identityQueriesFrom(services);
}

/** The use cases, for the server-rendered site's no-JavaScript forms (FR-35). */
export function createIdentityUseCasesFor(deps: IdentityDeps): IdentityUseCases {
  return createIdentityUseCases(servicesFor(deps, { warn: (obj, msg) => console.warn(msg, obj) }));
}

/** `staff:grant|revoke|reset-2fa <email>` (FR-5). Returns the message to print. */
export function runStaffCommand(
  deps: { db: Database; clock: Clock; ids: IdGenerator },
  command: StaffCommand,
  email: string,
): Promise<string> {
  return createIdentityUseCasesFor({
    ...deps,
    analytics: { track: () => Promise.resolve() },
    email: { send: () => Promise.resolve() },
    cipher: { encrypt: (v) => v, decrypt: (v) => v },
    audit: { record: () => Promise.resolve() },
    appUrl: 'http://localhost',
    secureCookies: false,
  }).runStaffCommand.execute({ command, email });
}

export type { StaffCommand } from './application/staff-commands.js';

// Seed -------------------------------------------------------------------------------------------

interface DemoIds {
  businesses: {
    sweetSupply: string;
    cleanDesk: string;
    cornerCoffee: string;
    llynerInternal: string;
  };
  members: { owner: string; newOwner: string; lowOwner: string; staff: string };
  password: string;
  staffTotpSecret: string;
}

export interface IdentitySeedDeps {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  demo: DemoIds;
  /** platform's SecretBox. Without it the Staff demo account sets up two-factor at first login. */
  cipher?: SecretCipher;
  logger?: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void };
}

/**
 * Demo data (PRD section 8a), called by scripts/seed.ts in dependency order. Never in production.
 * Idempotent: records that exist (by id or email) are left as they are. All demo Members are
 * verified, with password `demo1234` (shorter than the sign-up rule, so written directly).
 */
export async function seed(deps: IdentitySeedDeps): Promise<void> {
  const { demo } = deps;
  const now = deps.clock.now();
  const repos = kyselyIdentityRepos(deps.db, () => deps.ids.next());
  const passwordHash = await new BcryptPasswordHasher().hash(demo.password);
  const accounts = [
    {
      b: demo.businesses.sweetSupply,
      name: 'Sweet Supply Co',
      m: demo.members.owner,
      email: 'owner@demo.test',
      person: 'Sam Rivera',
      staff: false,
    },
    {
      b: demo.businesses.cleanDesk,
      name: 'Clean Desk Co',
      m: demo.members.newOwner,
      email: 'new@demo.test',
      person: 'Nia Brooks',
      staff: false,
    },
    {
      b: demo.businesses.cornerCoffee,
      name: 'Corner Coffee Roasters',
      m: demo.members.lowOwner,
      email: 'low@demo.test',
      person: 'Leo Marsh',
      staff: false,
    },
    {
      b: demo.businesses.llynerInternal,
      name: 'Llyner Leads (internal)',
      m: demo.members.staff,
      email: 'staff@demo.test',
      person: 'Demo Staff',
      staff: true,
    },
  ];
  for (const a of accounts) {
    if (!(await repos.businesses.findById(a.b))) {
      await repos.businesses.save(
        Business.create({ id: a.b, name: a.name, now, internal: a.staff }),
      );
    }
    if (await repos.members.findByEmail(a.email)) continue;
    const member = Member.registerOwner({
      id: a.m,
      businessId: a.b,
      email: a.email,
      name: a.person,
      passwordHash,
      now,
    });
    member.verifyEmail(now);
    if (a.staff) {
      member.grantStaff();
      if (deps.cipher) {
        member.enableTwoFactorWith(deps.cipher.encrypt(demo.staffTotpSecret), now);
      } else {
        deps.logger?.warn({}, 'identity seed: no cipher, Staff two-factor left to set up');
      }
    }
    await repos.members.save(member);
  }
}
