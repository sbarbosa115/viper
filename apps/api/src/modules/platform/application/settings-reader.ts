import type { Ceilings } from '@app/contracts/platform';
import type { Clock } from '../../../shared/domain/clock.js';
import {
  SECRET_FIELDS,
  SETTINGS_SECTIONS,
  emptySection,
  setPath,
  withDefaults,
  type PlainValues,
  type ProviderKey,
  type SettingsSectionKey,
  type StoredSection,
} from '../domain/settings.js';
import type { SecretBox, SettingsRepository } from './ports.js';

export interface AiSettings {
  readonly anthropicApiKey: string | null;
  readonly planningModel: string;
  readonly chatModel: string;
  readonly fastModel: string;
}

export interface ProviderCredentials {
  readonly apify: { readonly apiKey: string | null };
  readonly googleMaps: { readonly apiKey: string | null };
  readonly firecrawl: { readonly apiKey: string | null };
  readonly apollo: { readonly apiKey: string | null };
  readonly hunter: { readonly apiKey: string | null };
  readonly zerobounce: { readonly apiKey: string | null };
  readonly twilio: { readonly accountSid: string | null; readonly authToken: string | null };
}

export type TlsMode = 'starttls' | 'tls' | 'none';

export interface EmailSettings {
  readonly host: string | null;
  readonly port: number;
  readonly username: string | null;
  readonly password: string | null;
  readonly tls: TlsMode;
  readonly fromName: string;
  readonly fromAddress: string | null;
  readonly replyTo: string | null;
}

export interface StripeSettings {
  readonly secretKey: string | null;
  readonly webhookSecret: string | null;
  readonly taxEnabled: boolean;
}

export interface AnalyticsSettings {
  readonly gaMeasurementId: string | null;
}
export interface LandingSettings {
  readonly youtubeVideoId: string | null;
}
export interface SupportSettings {
  readonly supportEmail: string | null;
}

/**
 * Platform settings for server use, with secrets decrypted (ADR 0012). Values are cached for at
 * most 60 s, so a change saved in the back office reaches api and worker within a minute.
 * Never send what this returns to a client or a log.
 */
export interface SettingsReader {
  ai(): Promise<AiSettings>;
  provider<K extends ProviderKey>(key: K): Promise<ProviderCredentials[K]>;
  email(): Promise<EmailSettings>;
  stripe(): Promise<StripeSettings>;
  analytics(): Promise<AnalyticsSettings>;
  ceilings(): Promise<Ceilings>;
  landing(): Promise<LandingSettings>;
  support(): Promise<SupportSettings>;
  /** Drops the cache so the next read loads from the database. */
  invalidate(): void;
}

export const SETTINGS_CACHE_TTL_MS = 60_000;

type Snapshot = Readonly<Record<SettingsSectionKey, PlainValues>>;

/** Decrypts every secret of a section into its values; an unreadable secret reads as null. */
export function revealSection(stored: StoredSection, box: SecretBox): PlainValues {
  let values = withDefaults(stored.section, stored.values);
  for (const path of SECRET_FIELDS[stored.section]) {
    const sealed = stored.secrets[path];
    let plain: string | null = null;
    if (sealed) {
      try {
        plain = box.decrypt(sealed, `${stored.section}.${path}`);
      } catch {
        // Sealed under a lost or rotated key: the secret must be entered again (ADR 0012).
        plain = null;
      }
    }
    values = setPath(values, path, plain);
  }
  return values;
}

export class CachedSettingsReader implements SettingsReader {
  private cached: { snapshot: Promise<Snapshot>; loadedAt: number } | null = null;

  constructor(
    private readonly deps: {
      repository: SettingsRepository;
      secretBox: SecretBox;
      clock: Clock;
      ttlMs?: number;
    },
  ) {}

  invalidate(): void {
    this.cached = null;
  }

  private snapshot(): Promise<Snapshot> {
    const now = this.deps.clock.now().getTime();
    const ttl = this.deps.ttlMs ?? SETTINGS_CACHE_TTL_MS;
    if (this.cached && now - this.cached.loadedAt < ttl) return this.cached.snapshot;
    const snapshot = this.load();
    this.cached = { snapshot, loadedAt: now };
    snapshot.catch(() => {
      if (this.cached?.snapshot === snapshot) this.cached = null;
    });
    return snapshot;
  }

  private async load(): Promise<Snapshot> {
    const rows = new Map((await this.deps.repository.findAll()).map((s) => [s.section, s]));
    const entries = SETTINGS_SECTIONS.map(
      (section) =>
        [
          section,
          revealSection(rows.get(section) ?? emptySection(section), this.deps.secretBox),
        ] as const,
    );
    return Object.fromEntries(entries) as Snapshot;
  }

  private async section<T>(key: SettingsSectionKey): Promise<T> {
    // The stored values were validated against the contract schemas when saved.
    return (await this.snapshot())[key] as unknown as T;
  }

  ai(): Promise<AiSettings> {
    return this.section('ai');
  }
  async provider<K extends ProviderKey>(key: K): Promise<ProviderCredentials[K]> {
    return (await this.section<ProviderCredentials>('providers'))[key];
  }
  email(): Promise<EmailSettings> {
    return this.section('email');
  }
  stripe(): Promise<StripeSettings> {
    return this.section('stripe');
  }
  analytics(): Promise<AnalyticsSettings> {
    return this.section('analytics');
  }
  ceilings(): Promise<Ceilings> {
    return this.section('ceilings');
  }
  landing(): Promise<LandingSettings> {
    return this.section('landing');
  }
  support(): Promise<SupportSettings> {
    return this.section('support');
  }
}
