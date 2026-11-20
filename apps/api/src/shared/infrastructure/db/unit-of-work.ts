import type { Kysely, Transaction } from 'kysely';
import type { UnitOfWork } from '../../application/unit-of-work.js';
import type { DB } from './schema.js';

/**
 * Generic UnitOfWork on `db.transaction()`. Each module passes a factory that builds its
 * repositories on the transaction handle.
 */
export class KyselyUnitOfWork<Repos> implements UnitOfWork<Repos> {
  constructor(
    private readonly db: Kysely<DB>,
    private readonly buildRepos: (trx: Transaction<DB>) => Repos,
  ) {}

  run<T>(fn: (repos: Repos) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => fn(this.buildRepos(trx)));
  }
}
