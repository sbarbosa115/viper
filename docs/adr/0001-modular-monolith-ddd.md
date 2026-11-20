# 0001. Modular monolith with DDD and hexagonal layers

- Status: Accepted
- Date: 2026-11-18

## Context
One founder plus Claude is building a product with eight bounded contexts (docs/architecture/context-map.md). We need clear boundaries for parallel agents without the cost of distributed systems.

## Decision
One deployable codebase, one module per bounded context under `apps/api/src/modules/<context>`, each with `domain`, `application`, `infrastructure` and `http` layers. Modules talk only through their public `index.ts`. `eslint-plugin-boundaries` enforces the rules. The API and the worker are two entry points into the same modules.

## Alternatives considered
- Microservices: operational cost and latency with no benefit at this size.
- Unstructured monolith: fast at first, but boundaries erode and parallel builds collide.

## Consequences
Any module can be extracted later because its boundary already exists. The build skills rely on this layout.
