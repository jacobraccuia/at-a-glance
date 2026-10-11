# Architecture

## Overview

"Working Title" is an adaptive personal assistant that reduces the cognitive load
of tracking commitments. Phase 1 scope (this document reflects Phase 1 + future
hooks): a REST API backend backed by PostgreSQL, with a minimal web client used
for development and daily-driving the app until the native iOS client (Phase 3)
exists. Assistant/AI, calendar, and open-loop/connector features are deliberately
deferred to later phases per `CURSOR_MASTER_PROMPT.md`.

## Stack decision (confirmed with product owner 2026-10-11)

| Layer | Choice | Rationale |
|---|---|---|
| Backend runtime | Node.js + TypeScript | Shared types with future clients, fast iteration, mature ecosystem |
| HTTP framework | Express | Simple, well understood, low ceremony for Phase 1 |
| Database | PostgreSQL | Relational integrity for durable task/event model, matches master prompt |
| DB hosting (local dev) | Docker Compose | Reproducible, no host Postgres install conflicts |
| ORM / migrations | Prisma | Type-safe queries, first-class migration history, good DX |
| Phase 1 client | React + Vite (TypeScript) | Minimal UI to exercise every Phase 1 feature; disposable once SwiftUI (Phase 3) exists, not meant to be the final product UI |
| Testing | Vitest + Supertest | Unit tests for recurrence/event logic, integration tests against a real test database |
| Auth (Phase 1) | Email + password, server-side session (signed cookie) via `bcrypt` + `express-session` | Real persisted identity, no OAuth complexity yet; replaceable later without schema rewrite |

Not yet decided (explicitly deferred, will be revisited at the relevant phase):
- LLM adapter provider/interface (Phase 2)
- Calendar OAuth provider specifics (Phase 4)
- Email connector provider (Phase 5)
- Native iOS project structure, ActivityKit/App Intents targets (Phase 3)

## Repository layout

```
/
  CURSOR_MASTER_PROMPT.md
  docs/
    architecture.md          <- this file
    implementation-plan.md
    data-model.md
    integrations.md
    privacy.md
  server/                     <- Node/TS/Express/Prisma API
    prisma/
      schema.prisma
      migrations/
      seed.ts
    src/
      ...
    test/
  web/                         <- React/Vite Phase 1 client
    src/
  docker-compose.yml           <- local Postgres
  README.md
```

## Branding configuration

Per master prompt, the product name ("Working Title") and assistant name
("Assistant") must never be hardcoded. `server/src/config/branding.ts` and
`web/src/config/branding.ts` are the single sources of truth, read from
environment variables with safe defaults, never embedded in table names,
routes, or identifiers.

## Platform limitations acknowledged now (apply in later phases)

- **ActivityKit Live Activities** (Phase 3): cannot be guaranteed to persist
  indefinitely or auto-start every morning without a push trigger or user
  action; a widget/notification fallback is required.
- **Siri / App Intents** (Phase 3): iOS-only, requires physical device testing
  for several capabilities (cannot be fully verified in simulator).
- **Email integration** (Phase 5): only provider OAuth (e.g., Gmail API) or
  user-initiated forwarding/share-sheet capture is feasible. No generic inbox
  scraping.
- **Instagram DMs / Facebook Messenger / iMessage / SMS / Teams**: no
  supported, compliant API for automatic scanning exists. Manual share-sheet
  capture only, permanently, unless a platform publishes a compliant API.

## Vertical slice / testability principle

Every phase ships: schema + migration, API endpoints, tests (unit +
integration where applicable), and a way to manually exercise the feature
through the Phase 1 web client (or native app once it exists). No feature is
marked "done" without a passing test run shown to the user.
