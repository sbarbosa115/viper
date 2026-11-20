import type { Kysely, Selectable, Transaction } from 'kysely';
import type { DB } from '../../../shared/infrastructure/db/schema.js';
import type { SettingsRepository } from '../application/ports.js';
import {
  SETTINGS_SECTIONS,
  type PlainValues,
  type SealedSecret,
  type SettingsSectionKey,
  type StoredSection,
} from '../domain/settings.js';
import type { EncryptedSecret, SettingsTable } from './tables.js';

function isSection(value: string): value is SettingsSectionKey {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

function toDomain(row: Selectable<SettingsTable>): StoredSection | null {
  if (!isSection(row.section)) return null;
  const secrets: Record<string, SealedSecret> = {};
  for (const [path, s] of Object.entries(row.secrets_enc ?? {})) {
    secrets[path] = {
      ciphertext: s.ciphertext,
      iv: s.iv,
      tag: s.tag,
      last4: s.last4,
      updatedAt: new Date(s.updatedAt),
    };
  }
  return {
    section: row.section,
    values: row.value_json as PlainValues,
    secrets,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function secretsToRow(secrets: StoredSection['secrets']): Record<string, EncryptedSecret> {
  return Object.fromEntries(
    Object.entries(secrets).map(([path, s]) => [
      path,
      {
        ciphertext: s.ciphertext,
        iv: s.iv,
        tag: s.tag,
        last4: s.last4,
        updatedAt: s.updatedAt.toISOString(),
      },
    ]),
  );
}

export class KyselySettingsRepository implements SettingsRepository {
  constructor(private readonly db: Kysely<DB> | Transaction<DB>) {}

  async findAll(): Promise<StoredSection[]> {
    const rows = await this.db.selectFrom('settings').selectAll().execute();
    return rows.flatMap((row) => toDomain(row) ?? []);
  }

  async find(section: SettingsSectionKey): Promise<StoredSection | null> {
    const row = await this.db
      .selectFrom('settings')
      .selectAll()
      .where('section', '=', section)
      .forUpdate()
      .executeTakeFirst();
    return row ? toDomain(row) : null;
  }

  async save(section: StoredSection): Promise<void> {
    const row = {
      value_json: JSON.stringify(section.values),
      secrets_enc: JSON.stringify(secretsToRow(section.secrets)),
      updated_by: section.updatedBy,
      updated_at: section.updatedAt ?? new Date(0),
    };
    await this.db
      .insertInto('settings')
      .values({ section: section.section, ...row })
      .onDuplicateKeyUpdate(row)
      .execute();
  }
}
