import type { PlatformSettings, SettingsSection } from '@app/contracts/platform';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { Actor } from '../../../shared/domain/actor.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/id-generator.js';
import {
  SETTINGS_SECTIONS,
  emptySection,
  last4Of,
  planSectionUpdate,
  presentSection,
  type SealedSecret,
  type StoredSection,
} from '../domain/settings.js';
import { auditEntry } from './audit-log.js';
import type {
  AuditLogRepository,
  ConnectivityResult,
  ConnectivityTester,
  SecretBox,
  SettingsRepository,
} from './ports.js';
import type { SettingsReader } from './settings-reader.js';
import { requireStaff } from './staff-policy.js';

export interface SettingsRepos {
  settings: SettingsRepository;
  auditLog: AuditLogRepository;
}

/** GET /api/staff/settings: every section, secrets masked (FR-8). */
export class GetSettings {
  constructor(private readonly deps: { repository: SettingsRepository }) {}

  async execute(cmd: { actor: Actor | null }): Promise<PlatformSettings> {
    requireStaff(cmd.actor);
    const rows = new Map((await this.deps.repository.findAll()).map((s) => [s.section, s]));
    const view = Object.fromEntries(
      SETTINGS_SECTIONS.map((key) => [key, presentSection(rows.get(key) ?? emptySection(key))]),
    );
    // presentSection lays stored values (validated by the contract when saved) over the defaults.
    return view as unknown as PlatformSettings;
  }
}

/**
 * PUT /api/staff/settings/:section: saves one section, seals new secrets, and writes one Audit
 * log entry `settings.<section>.updated` with the changed field names (FR-7, FR-8).
 */
export class UpdateSettingsSection {
  constructor(
    private readonly deps: {
      uow: UnitOfWork<SettingsRepos>;
      secretBox: SecretBox;
      reader: SettingsReader;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  async execute<S extends SettingsSection>(cmd: {
    actor: Actor | null;
    section: S;
    input: Readonly<Record<string, unknown>>;
  }): Promise<PlatformSettings[S]> {
    const actor = requireStaff(cmd.actor);
    const now = this.deps.clock.now();
    const saved = await this.deps.uow.run(async ({ settings, auditLog }) => {
      const current = (await settings.find(cmd.section)) ?? emptySection(cmd.section);
      const plan = planSectionUpdate(current, cmd.input);
      const secrets: Record<string, SealedSecret> = { ...current.secrets };
      for (const change of plan.secretChanges) {
        if (change.value === null) {
          delete secrets[change.path];
          continue;
        }
        const sealed = this.deps.secretBox.encrypt(change.value, `${cmd.section}.${change.path}`);
        secrets[change.path] = { ...sealed, last4: last4Of(change.value), updatedAt: now };
      }
      const next: StoredSection = {
        section: cmd.section,
        values: plan.values,
        secrets,
        updatedBy: actor.memberId,
        updatedAt: now,
      };
      await settings.save(next);
      await auditLog.append(
        auditEntry(
          {
            staffMemberId: actor.memberId,
            businessId: null,
            action: `settings.${cmd.section}.updated`,
            targetType: 'settings',
            targetId: cmd.section,
            details: { fields: plan.changedFields },
          },
          this.deps,
        ),
      );
      return next;
    });
    this.deps.reader.invalidate();
    return presentSection(saved) as unknown as PlatformSettings[S];
  }
}

export const TEST_TIMEOUT_MS = 15_000;

/** POST /api/staff/settings/test: one connectivity check, `{ ok: false }` after 15 s (FR-8). */
export class TestSettings {
  constructor(
    private readonly deps: {
      tester: ConnectivityTester;
      reader: SettingsReader;
      timeoutMs?: number;
    },
  ) {}

  async execute(cmd: {
    actor: Actor | null;
    target: keyof ConnectivityTester;
    to?: string | undefined;
  }): Promise<ConnectivityResult> {
    requireStaff(cmd.actor);
    // Test what was just saved, not a cached copy.
    this.deps.reader.invalidate();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<ConnectivityResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ ok: false, message: 'Timed out' });
      }, this.deps.timeoutMs ?? TEST_TIMEOUT_MS);
    });
    const check = this.deps.tester[cmd.target];
    const run = check({ to: cmd.to, signal: controller.signal }).catch((): ConnectivityResult => ({
      ok: false,
      message: 'The test failed unexpectedly',
    }));
    try {
      return await Promise.race([run, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface PublicConfig {
  gaMeasurementId: string | null;
  supportEmail: string | null;
  youtubeVideoId: string | null;
}

/** GET /api/public/config (FR-9, FR-34). */
export class GetPublicConfig {
  constructor(private readonly deps: { reader: SettingsReader }) {}

  async execute(): Promise<PublicConfig> {
    const [analytics, support, landing] = await Promise.all([
      this.deps.reader.analytics(),
      this.deps.reader.support(),
      this.deps.reader.landing(),
    ]);
    return {
      gaMeasurementId: analytics.gaMeasurementId,
      supportEmail: support.supportEmail,
      youtubeVideoId: landing.youtubeVideoId,
    };
  }
}
