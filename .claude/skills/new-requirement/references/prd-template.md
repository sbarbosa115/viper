# PRD template

Copy this structure into `docs/prd-<slug>.md`. **Keep the section numbers.** Other skills reference them. A section that doesn't apply keeps its heading with "Not applicable: <why>".

````markdown
# PRD: <Feature name>

| Field   | Value |
|---------|-------|
| Status  | Draft / Approved / Building / Built / Shipped |
| Version | 0.1 |
| Date    | YYYY-MM-DD |
| Persona | <from product.md> |
| Tests assumption | A-n: <assumption> |

## 1. Overview
What is being built, for whom, and why, in one paragraph.

## 2. Problem
What users do today and why it hurts.

## 3. Goals & success metrics
- G-1: <goal>. Metric: <measurable target, timeframe>
### Non-goals
- <out of scope>

## 3a. Measurement
| Event | When it fires | Properties | Proves |
|-------|---------------|------------|--------|
| `order_placed` | order confirmed | order_id, total_cents, item_count | G-1 |

## 4. Users & permissions
| Role | Can | Cannot |
|------|-----|--------|

## 5. Scope
### Cut line (smallest shippable version)
- <story>
### Later
- <story>

## 6. Functional requirements
### FR-1: <name>
**Story:** As a <role>, I want <action> so that <benefit>.
**Rules:** inputs, validation, computations, outputs.
**Errors / edge cases:** …
**Acceptance criteria:**
- Given <context>, when <action>, then <result>.

## 6a. Acceptance journeys
### AJ-1: <journey name>
**Persona:** <persona> · **Covers:** FR-1, FR-2
1. <step in the browser>
2. …
**Expected:** <what the user sees at the end>

## 6b. Screens
Mocks (Design artifact): <canvas URL>. Workflow row: <name>. Screen rows (mobile and desktop, before and after): <names>.

| Screen | Route | Purpose | Empty / loading / error states |
|--------|-------|---------|--------------------------------|

## 7. Interfaces
### `POST /api/orders`: <purpose>
- Auth: <role(s)>
- Request: `{ items: [{ productId: uuid, quantity: int 1..99 }] }`
- Response 201: `{ id: uuid, status: "pending", totalCents: int }`
- Errors: 400 VALIDATION_ERROR, 401, 403, 409 CONFLICT <when>, 422 RULE_VIOLATION <when>

### External integrations
- <service>: purpose, authentication, behaviour when it's down

## 8. Data model
| Entity | Fields (type, constraints) | Relationships | Context |
|--------|----------------------------|---------------|---------|
Volume, retention, migration of existing data.

### 8a. Demo seed data
Users per role (`<role>@demo.test` / `demo1234`) and sample records. Never real personal data.

## 9. Technical notes
Stack: see docs/architecture/stack.md. List only what this feature adds or does differently (new dependency, new port or adapter, cron job, deviation plus its ADR).

## 10. Non-functional requirements
- NFR-1: Performance: <measurable>
- NFR-2: Security / privacy: …
- NFR-3: Accessibility: WCAG 2.1 AA for new screens

## 11. Testing notes
Anything beyond the standard (unit, integration, HTTP and web tests per FR, Playwright per AJ, all in Docker), such as load tests or a specific browser.

## 12. Release notes
Migrations, feature flags, config or secrets needed, data backfill, rollout (staging first, then production).

## 13. Assumptions & decisions
- <decided on the user's behalf>: rationale

## 14. Risks & open questions
- [ ] <question>: owner, blocking? yes/no

## 15. Change log
| Version | Date | Change |
|---------|------|--------|
| 0.1 | YYYY-MM-DD | Initial draft |

## 16. Execution plan
| Wave | Package | Title | Model | Depends on | FRs / AJs |
|------|---------|-------|-------|------------|-----------|

| Wave | Demo: what you can see or try | Journeys unlocked |
|------|-------------------------------|-------------------|

```yaml
execution: …   # format in execution-plan.md
```

## 17. Implementation notes
_Filled in by /build-requirement: FR → test files, AJ → Playwright specs, sign-off per wave, decisions on gaps._
````
