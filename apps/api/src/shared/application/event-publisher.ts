/**
 * Publishes a domain event through the outbox, inside the current Unit of Work's transaction.
 * Use cases depend on this port, typed with the outbox event map
 * (`EventPublisher<OutboxEvents>`); a module's UoW binds it to `outbox.add(trx, …)`.
 */
export interface EventPublisher<Events> {
  publish<T extends keyof Events & string>(type: T, payload: Events[T]): Promise<void>;
}
