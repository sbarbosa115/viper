# Backend architecture

## Contents
1. Layout
2. Layer rules
3. How much DDD to apply
4. Code patterns (value object, entity, port, use case, repository, route, errors, composition)
5. Cross-module communication
6. Hosting constraints (DigitalOcean App Platform)

## 1. Layout

```
apps/api/
  src/
    main.ts                    # composition root: config, db, modules, server start
    app.ts                     # buildApp(config, deps): Fastify instance, all routes under /api (orchestrator-owned)
    config/env.ts              # Zod-validated env, parsed only in main.ts
    shared/
      domain/                  # base errors, Actor, Clock and IdGenerator ports
      application/             # cross-cutting ports: AnalyticsTracker, EmailSender, Features
      infrastructure/db/       # Kysely pool, schema.ts (composes every module's tables.ts), UnitOfWork
      http/                    # error handler, auth plugin, pagination helpers
    modules/
      <context>/               # e.g. orders
        domain/                # entities, value objects, domain services, domain events, errors
        application/           # use cases, ports (repository/service interfaces), DTO mappers
        infrastructure/        # tables.ts (this module's Kysely table types), repositories, mappers, external clients
        http/                  # Fastify routes for this module
        test/                  # this module's fakes and factories
        index.ts               # public API: register(app, deps), seed(deps), use cases/types for other modules
  migrations/                  # <YYYYMMDDHHmmss>_<module>_<change>.ts
  test/                        # build-test-app.ts, global-setup.ts, shared factories (Wave 0)
packages/contracts/
  src/<context>.ts             # Zod schemas for request/response DTOs shared with apps/web
```

Tests live next to the code they test (`order.test.ts` beside `order.ts`); repository tests use the suffix `.int.test.ts` so they can run separately.

## 2. Layer rules

```
http ──► application ──► domain
infrastructure ──► application (implements ports) ──► domain
```

- `domain` imports nothing outside itself and `shared/domain`.
- `application` imports `domain`; defines **ports** (interfaces) for everything with I/O.
- `infrastructure` implements ports; only place that touches Kysely/mysql2/HTTP clients.
- `http` parses input with Zod, calls a use case, maps result to a response. No business logic.
- Other modules import only from `modules/<other>/index.ts`.

Enforce with `eslint-plugin-boundaries` (or `import/no-restricted-paths`) so violations fail lint instead of relying on discipline.

## 3. How much DDD to apply

Match the tactical weight to the domain's complexity — over-engineering CRUD is as much a senior-level mistake as under-modelling a complex domain.

- **Rich domain** (rules, state machines, calculations, invariants across entities): full aggregates, value objects, domain events.
- **Simple CRUD** (settings, lookup tables): a thin use case + repository is fine; still keep validation at the edge and the layer separation, so the module can grow.

Aggregate guidelines: one repository per aggregate root; reference other aggregates by ID, not object; keep aggregates small; one aggregate modified per transaction where possible.

## 4. Code patterns

### Errors (`shared/domain/errors.ts`)
```ts
export abstract class AppError extends Error {
  abstract readonly code: string;
  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationError extends AppError { readonly code = 'VALIDATION_ERROR'; }
export class NotFoundError extends AppError { readonly code = 'NOT_FOUND'; }
export class ConflictError extends AppError { readonly code = 'CONFLICT'; }
export class ForbiddenError extends AppError { readonly code = 'FORBIDDEN'; }
export class DomainRuleViolation extends AppError { readonly code = 'RULE_VIOLATION'; }
```

### Value object
```ts
export class Email {
  private constructor(readonly value: string) {}
  static create(raw: string): Email {
    const v = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ValidationError('Invalid email', { raw });
    return new Email(v);
  }
  equals(other: Email) { return this.value === other.value; }
}
```

### Entity / aggregate root
```ts
type OrderStatus = 'pending' | 'paid' | 'cancelled';

export class Order {
  private constructor(
    readonly id: OrderId,
    readonly customerId: CustomerId,
    private _status: OrderStatus,
    private _lines: OrderLine[],
    readonly createdAt: Date,
  ) {}

  static place(props: { id: OrderId; customerId: CustomerId; lines: OrderLine[]; now: Date }): Order {
    if (props.lines.length === 0) throw new DomainRuleViolation('Order needs at least one line');
    return new Order(props.id, props.customerId, 'pending', props.lines, props.now);
  }

  /** Rehydrate from persistence — no invariant re-checks, no events. */
  static restore(s: OrderSnapshot): Order { /* ... */ }

  cancel(): void {
    if (this._status === 'paid') throw new DomainRuleViolation('Paid orders cannot be cancelled');
    this._status = 'cancelled';
  }

  get status() { return this._status; }
  get totalCents() { return this._lines.reduce((s, l) => s + l.subtotalCents, 0); }
  toSnapshot(): OrderSnapshot { /* plain object for repositories */ }
}
```

### Port (application)
```ts
export interface OrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  save(order: Order): Promise<void>;
}
export interface Clock { now(): Date; }
export interface UnitOfWork { run<T>(fn: (repos: { orders: OrderRepository }) => Promise<T>): Promise<T>; }
```

### Use case
```ts
export class CancelOrder {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(cmd: { orderId: string; actor: Actor }): Promise<void> {
    await this.uow.run(async ({ orders }) => {
      const order = await orders.findById(OrderId.from(cmd.orderId));
      if (!order) throw new NotFoundError('Order not found', { orderId: cmd.orderId });
      if (!cmd.actor.canManage(order.customerId)) throw new ForbiddenError('Not allowed');
      order.cancel();
      await orders.save(order);
    });
  }
}
```
One class (or function) per use case, named as a verb phrase from the PRD. Use cases return plain DTOs, not entities, to callers outside the module.

### Kysely repository (infrastructure)
```ts
export class KyselyOrderRepository implements OrderRepository {
  constructor(private readonly db: Kysely<DB> | Transaction<DB>) {}

  async findById(id: OrderId) {
    const row = await this.db.selectFrom('orders').selectAll().where('id', '=', id.value).executeTakeFirst();
    if (!row) return null;
    const lines = await this.db.selectFrom('order_lines').selectAll().where('order_id', '=', id.value).execute();
    return OrderMapper.toDomain(row, lines);
  }

  async save(order: Order) {
    const s = order.toSnapshot();
    await this.db.insertInto('orders').values(OrderMapper.toRow(s))
      .onDuplicateKeyUpdate({ status: s.status, updated_at: s.updatedAt }).execute();   // time comes from the domain (Clock), not new Date()
    // lines: delete+insert or diff, inside the same transaction
  }
}
```
Mapping between rows and domain objects lives in a mapper in `infrastructure/`, never in the entity.

### Route (http)
```ts
import { cancelOrderParams } from '@app/contracts/orders';

export function orderRoutes(app: FastifyInstance, deps: { cancelOrder: CancelOrder }) {
  // registered by app.ts under the /api prefix → POST /api/orders/:id/cancel
  app.post('/orders/:id/cancel', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = cancelOrderParams.parse(req.params);
    await deps.cancelOrder.execute({ orderId: id, actor: req.actor });
    return reply.status(204).send();
  });
}
```
(Use `fastify-type-provider-zod` so schemas also drive validation and OpenAPI docs.)

### Central error handler
Maps `AppError` subclasses to status codes (ValidationError and Zod errors 400 with field details, unauthenticated 401, ForbiddenError 403, NotFoundError 404, ConflictError 409, DomainRuleViolation 422), everything else to 500 with a generic message (log the real error with pino, including request id). Response shape:
```json
{ "error": { "code": "NOT_FOUND", "message": "Order not found", "details": {} } }
```

### Composition root
`main.ts` parses env, creates the Kysely pool, builds each module's dependencies (repositories → use cases), passes config and dependencies to `buildApp()`, and starts listening. Tests use `buildTestApp()` with fakes or the test DB, and never touch `process.env`.

## 5. Cross-module communication

- **Synchronous**: call the other module's exported use case / query from its `index.ts`.
- **Reacting to changes**: in-process domain events (simple typed event bus) dispatched after the transaction commits. If reliability matters (e.g. sending emails, payments), use a transactional **outbox** table drained by the worker into BullMQ queues (ADR 0008).
- Never join across another module's tables in SQL; ask the module.

## 6. Hosting constraints that shape the code (DigitalOcean App Platform)
- **Stateless containers.** App Platform replaces api and worker containers on every deploy, restart or crash, and may run more than one: no in-memory sessions, caches you depend on (Valkey or MySQL instead; small TTL caches like Platform settings are fine), or in-process schedulers.
- **Background work runs in the worker** (`apps/api/src/worker.ts`, BullMQ on Valkey, ADR 0008). Jobs must be idempotent and resumable (ADR 0017): a deploy sends `SIGTERM` and the job may run again on another container.
- **Graceful shutdown.** Handle `SIGTERM`: stop taking work, close servers, queues and pools, exit.
- **One bundle, no `node_modules` at runtime.** The image runs `dist/` only (`node:24-slim`). Pure-JS dependencies by preference; a native module must build on `node:24-slim` and be listed in the build's `external`. Files read at runtime are copied into `dist/` by `build.mjs`.
- **Config from env, validated at boot** (`config/env.ts`): only infrastructure secrets (database, Valkey, session secret, encryption key, Sentry). Provider, Claude, SMTP and Stripe keys come from Platform settings (ADR 0012).
- **Managed MySQL rules:** every table has a primary key (`sql_require_primary_key` is on), connections use TLS, and migrations run as a pre-deploy job before new code goes live, so they must be compatible with the code already running (expand and contract).
- **One origin** (ADR 0016): the public site at `/` and the API under `/api` (all API routes use the `/api` prefix) come from the api service; the SPA is a static site at `/app`. The health check is `GET /api/health`.
- Deployment itself: `/ship-requirement`.
