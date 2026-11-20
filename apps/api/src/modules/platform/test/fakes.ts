import type { SettingsTestTarget } from '@app/contracts/platform';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type {
  AuditCursor,
  AuditDirectory,
  AuditEntry,
  AuditLogFilter,
  AuditLogRepository,
  ConnectivityCheck,
  ConnectivityTester,
  SettingsRepository,
} from '../application/ports.js';
import { FixedClock } from '../../../shared/infrastructure/time/system-clock.js';
import { SequentialIdGenerator } from '../../../shared/infrastructure/time/uuid7.js';
import { ListAuditLog } from '../application/audit-log.js';
import type { SettingsReader } from '../application/settings-reader.js';
import { CachedSettingsReader, revealSection } from '../application/settings-reader.js';
import {
  GetPublicConfig,
  GetSettings,
  TestSettings,
  UpdateSettingsSection,
  type SettingsRepos,
} from '../application/settings-use-cases.js';
import type { PlatformRouteDeps } from '../http/platform.routes.js';
import { AesGcmSecretBox } from '../infrastructure/secret-box.js';
import {
  emptySection,
  setPath,
  type PlainValues,
  type ProviderKey,
  type SettingsSectionKey,
  type StoredSection,
} from '../domain/settings.js';

export class InMemorySettingsRepository implements SettingsRepository {
  readonly rows = new Map<SettingsSectionKey, StoredSection>();
  reads = 0;

  findAll(): Promise<StoredSection[]> {
    this.reads += 1;
    return Promise.resolve([...this.rows.values()].map((s) => structuredClone(s)));
  }
  find(section: SettingsSectionKey): Promise<StoredSection | null> {
    const row = this.rows.get(section);
    return Promise.resolve(row ? structuredClone(row) : null);
  }
  save(section: StoredSection): Promise<void> {
    this.rows.set(section.section, structuredClone(section));
    return Promise.resolve();
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditEntry[] = [];

  append(entry: AuditEntry): Promise<void> {
    this.entries.push(structuredClone(entry));
    return Promise.resolve();
  }

  list(filter: AuditLogFilter, cursor: AuditCursor | null, limit: number): Promise<AuditEntry[]> {
    const newestFirst = (a: AuditEntry, b: AuditEntry) =>
      b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    const before = (e: AuditEntry) =>
      !cursor ||
      e.at.getTime() < cursor.at.getTime() ||
      (e.at.getTime() === cursor.at.getTime() && e.id < cursor.id);
    return Promise.resolve(
      this.entries
        .filter(
          (e) =>
            (!filter.businessId || e.businessId === filter.businessId) &&
            (!filter.staffMemberId || e.staffMemberId === filter.staffMemberId) &&
            (!filter.action || e.action === filter.action) &&
            before(e),
        )
        .sort(newestFirst)
        .slice(0, limit)
        .map((e) => structuredClone(e)),
    );
  }
}

/** Commits on success only: writes made inside a failing callback are discarded. */
export class InMemorySettingsUnitOfWork implements UnitOfWork<SettingsRepos> {
  constructor(
    readonly settings = new InMemorySettingsRepository(),
    readonly auditLog = new InMemoryAuditLogRepository(),
  ) {}

  async run<T>(fn: (repos: SettingsRepos) => Promise<T>): Promise<T> {
    const settingsTx = new InMemorySettingsRepository();
    for (const [k, v] of this.settings.rows) settingsTx.rows.set(k, structuredClone(v));
    const auditTx = new InMemoryAuditLogRepository();
    const result = await fn({ settings: settingsTx, auditLog: auditTx });
    for (const [k, v] of settingsTx.rows) this.settings.rows.set(k, v);
    this.auditLog.entries.push(...auditTx.entries);
    return result;
  }
}

export class FakeAuditDirectory implements AuditDirectory {
  constructor(
    readonly members = new Map<string, { email: string }>(),
    readonly businesses = new Map<string, { name: string }>(),
  ) {}
  lookups = 0;

  lookup(query: { memberIds: readonly string[]; businessIds: readonly string[] }) {
    this.lookups += 1;
    const pick = <T>(source: Map<string, T>, ids: readonly string[]) =>
      new Map(ids.flatMap((id) => (source.has(id) ? [[id, source.get(id) as T] as const] : [])));
    return Promise.resolve({
      members: pick(this.members, query.memberIds),
      businesses: pick(this.businesses, query.businessIds),
    });
  }
}

/** Every target answers ok unless a test overrides it; records the calls it got. */
export function fakeConnectivityTester(
  overrides: Partial<Record<SettingsTestTarget, ConnectivityCheck>> = {},
): ConnectivityTester & { calls: { target: SettingsTestTarget; to?: string | undefined }[] } {
  const calls: { target: SettingsTestTarget; to?: string | undefined }[] = [];
  const targets: SettingsTestTarget[] = [
    'anthropic',
    'apify',
    'googleMaps',
    'firecrawl',
    'apollo',
    'hunter',
    'zerobounce',
    'twilio',
    'smtp',
    'stripe',
  ];
  const tester = Object.fromEntries(
    targets.map((target) => [
      target,
      (input: Parameters<ConnectivityCheck>[0]) => {
        calls.push({ target, to: input.to });
        return overrides[target]?.(input) ?? Promise.resolve({ ok: true, message: 'Connected' });
      },
    ]),
  ) as unknown as ConnectivityTester;
  return Object.assign(tester, { calls });
}

export const ids = {
  staff: '00000000-0000-7000-8000-00000000a001',
  staffBusiness: '00000000-0000-7000-8000-00000000b001',
  owner: '00000000-0000-7000-8000-00000000a002',
  business: '00000000-0000-7000-8000-00000000b002',
} as const;

export function staffActor(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: ids.staff,
    businessId: ids.staffBusiness,
    roles: ['owner', 'staff'],
    emailVerified: true,
    ...overrides,
  };
}

export function ownerActor(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: ids.owner,
    businessId: ids.business,
    roles: ['owner'],
    emailVerified: true,
    ...overrides,
  };
}

/** Staff Acting as the owner's Business: resolves as that Business's Owner (FR-6). */
export function staffActingAs(overrides: Partial<Actor> = {}): Actor {
  return {
    memberId: ids.staff,
    businessId: ids.business,
    roles: ['owner', 'staff'],
    emailVerified: true,
    actingAs: { businessId: ids.business, businessName: 'Sweet Supply Co', staffMemberId: ids.staff },
    ...overrides,
  };
}

const noSecrets = {
  encrypt: () => ({ ciphertext: '', iv: '', tag: '' }),
  decrypt: () => '',
};

/**
 * A SettingsReader over plain values (defaults plus `overrides` by dot path, e.g.
 * `{ 'email.host': 'smtp.test', 'providers.apify.apiKey': 'k' }`). No cache, no encryption.
 */
export function fakeSettingsReader(
  overrides: Readonly<Record<string, string | number | boolean | null>> = {},
): SettingsReader & { invalidations: number } {
  const section = (key: SettingsSectionKey): PlainValues => {
    let values = revealSection(emptySection(key), noSecrets);
    for (const [path, value] of Object.entries(overrides)) {
      const [head, ...rest] = path.split('.');
      if (head === key) values = setPath(values, rest.join('.'), value);
    }
    return values;
  };
  const as = <T>(key: SettingsSectionKey) => Promise.resolve(section(key) as unknown as T);
  const reader = {
    invalidations: 0,
    ai: () => as('ai'),
    provider: <K extends ProviderKey>(key: K) =>
      Promise.resolve((section('providers') as Record<string, unknown>)[key]),
    email: () => as('email'),
    stripe: () => as('stripe'),
    analytics: () => as('analytics'),
    ceilings: () => as('ceilings'),
    landing: () => as('landing'),
    support: () => as('support'),
    invalidate() {
      reader.invalidations += 1;
    },
  };
  return reader as unknown as SettingsReader & { invalidations: number };
}

/** Every platform use case on in-memory fakes, for HTTP tests. */
export function platformRouteFakes(
  options: { tester?: ConnectivityTester; directory?: AuditDirectory } = {},
) {
  const clock = new FixedClock(new Date('2026-11-19T10:00:00.000Z'));
  const secretBox = new AesGcmSecretBox(Buffer.alloc(32, 1));
  const uow = new InMemorySettingsUnitOfWork();
  const reader = new CachedSettingsReader({ repository: uow.settings, secretBox, clock });
  const tester = options.tester ?? fakeConnectivityTester();
  const directory = options.directory ?? new FakeAuditDirectory();
  const routes: PlatformRouteDeps = {
    getSettings: new GetSettings({ repository: uow.settings }),
    updateSettingsSection: new UpdateSettingsSection({
      uow,
      secretBox,
      reader,
      clock,
      ids: new SequentialIdGenerator(),
    }),
    testSettings: new TestSettings({ tester, reader }),
    getPublicConfig: new GetPublicConfig({ reader }),
    listAuditLog: new ListAuditLog({ repository: uow.auditLog, directory }),
  };
  return { routes, uow, reader, tester, clock };
}
