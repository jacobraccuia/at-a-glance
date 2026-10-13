# Taskr

An adaptive personal assistant for tracking life's commitments without the
cognitive overhead. See `CURSOR_MASTER_PROMPT.md` for the full product spec
and `docs/` for architecture, data model, implementation plan, integrations,
and privacy documentation.

**Status:** Phase 1 complete. Phase 2 assistant **is** the app — home (`/`)
is conversational chat (text + in-app mic) that can create, complete,
cancel, snooze, list, clarify, and surface **Easy Wins** (rules-based
picks that fit a short time budget). Thin secondary nav for Today /
Upcoming / All / Buckets. Today still has a text-only quick-add dump.
See `docs/implementation-plan.md` for built vs. still-deferred Phase 2
items. Native iOS / Siri / Watch are Phase 3.

**Live:** https://server-production-1374.up.railway.app

## Prerequisites

- Node.js 20+
- Docker Desktop (for local Postgres)

## Local setup

### 1. Start the database

```bash
docker compose up -d
```

Postgres will be available at `localhost:5433` (not the default 5432, to
avoid colliding with other local Postgres installs).

### 2. Backend (`server/`)

```bash
cd server
npm install
cp .env.example .env
npm run prisma:migrate   # applies migrations, creates schema
npm run seed              # creates demo@example.com / password123 with sample data
npm run dev                # starts API on http://localhost:4100
```

To enable AI-assisted quick capture locally, set `OPENAI_API_KEY` in
`server/.env`. Leave it unset to run fully deterministic (no external
calls) — this is a real, tested fallback path, not a degraded mode.

Run tests (unit + integration, against the real database):

```bash
npm test
```

### 3. Web client (`web/`)

In a second terminal:

```bash
cd web
npm install
cp .env.example .env
npm run dev   # starts on http://localhost:5173
```

Open `http://localhost:5173`, log in with `demo@example.com` / `password123`
(or register a new account).

## Project layout

```
CURSOR_MASTER_PROMPT.md   Full product specification
docs/                      Architecture, data model, plan, integrations, privacy
server/                    Node + TypeScript + Express + Prisma + Postgres API
web/                       React + Vite Phase 1 client (will be superseded by
                           native SwiftUI app in Phase 3; kept for development
                           and daily use in the meantime)
docker-compose.yml         Local Postgres for development
```

## Notes

- Port 4000 is intentionally avoided (commonly used by other local dev tools
  like Local.app); the API runs on 4100.
- Port 5432 is intentionally avoided for the same reason; Postgres runs on
  5433 locally (see `docker-compose.yml`).
- AI integration (Phase 2 core slice): quick capture is OpenAI-assisted when
  `OPENAI_API_KEY` is set, and purely deterministic otherwise. The model only
  *suggests* structured fields; the server always decides what's actually
  written to the database, and AI-set dates are never marked as explicit
  deadlines.
