/** Run a use case's writes in one transaction. Modules define their own repo bundle type. */
export interface UnitOfWork<Repos> {
  run<T>(fn: (repos: Repos) => Promise<T>): Promise<T>;
}
