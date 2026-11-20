import type { AnalyticsTracker } from '../../../shared/application/analytics-tracker.js';
import type { EmailSender } from '../../../shared/application/email-sender.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import type { Database } from '../../../shared/infrastructure/db/database.js';
import { KyselyUnitOfWork } from '../../../shared/infrastructure/db/unit-of-work.js';
import { KyselyOutbox, type Outbox } from '../../../shared/infrastructure/outbox/index.js';
import type {
  AuditRecorder,
  IdentityLogger,
  IdentityRepos,
  IdentityServices,
  PasswordHasher,
  SecretCipher,
  TokenService,
  TotpService,
} from '../application/ports.js';
import { KyselyBusinessDirectory, kyselyIdentityRepos } from './kysely-repositories.js';
import {
  BcryptPasswordHasher,
  CryptoTokenService,
  OtplibTotpService,
} from './security-adapters.js';

export interface KyselyIdentityDeps {
  db: Database;
  clock: Clock;
  ids: IdGenerator;
  analytics: AnalyticsTracker;
  email: EmailSender;
  cipher: SecretCipher;
  audit: AuditRecorder;
  logger: IdentityLogger;
  appUrl: string;
  /** Defaults: bcryptjs cost 12, crypto tokens, otplib. Tests may pass faster ones. */
  passwords?: PasswordHasher;
  tokens?: TokenService;
  totp?: TotpService;
  outbox?: Outbox;
}

/** IdentityServices on MySQL: repositories, the Unit of Work and the outbox for events. */
export function kyselyIdentityServices(deps: KyselyIdentityDeps): IdentityServices {
  const newId = () => deps.ids.next();
  const outbox = deps.outbox ?? new KyselyOutbox(deps.ids, deps.clock);
  return {
    uow: new KyselyUnitOfWork<IdentityRepos>(deps.db, (trx) => ({
      ...kyselyIdentityRepos(trx, newId),
      events: { publish: (type, payload) => outbox.add(trx, type, payload) },
      audit: { record: (entry) => deps.audit.record(entry, trx) },
    })),
    repos: kyselyIdentityRepos(deps.db, newId),
    directory: new KyselyBusinessDirectory(deps.db),
    clock: deps.clock,
    ids: deps.ids,
    passwords: deps.passwords ?? new BcryptPasswordHasher(),
    tokens: deps.tokens ?? new CryptoTokenService(),
    totp: deps.totp ?? new OtplibTotpService(),
    cipher: deps.cipher,
    audit: deps.audit,
    analytics: deps.analytics,
    email: deps.email,
    logger: deps.logger,
    appUrl: deps.appUrl,
  };
}
