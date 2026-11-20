# 0002. MySQL 8 with Kysely on DigitalOcean Managed MySQL

- Status: Accepted
- Date: 2026-11-18

## Context
We need a relational store with transactions for the credit ledger, leads and runs, managed backups, and type-safe queries.

## Decision
DigitalOcean Managed MySQL 8, accessed with `mysql2` and Kysely. Kysely migrations with `allowUnorderedMigrations` so parallel agents can add migrations. Docker tests use the same MySQL major and minor version as the cluster.

## Alternatives considered
- PostgreSQL: equally good; MySQL kept because the build skills and patterns already target it.
- Prisma / an ORM: heavier, generated clients, less control over SQL.

## Consequences
Daily managed backups and point-in-time recovery come from DigitalOcean. JSON columns hold flexible data (evidence, step config); queries stay explicit.
