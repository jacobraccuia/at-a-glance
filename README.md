# Taskr

An adaptive personal assistant for tracking life's commitments without the
cognitive overhead. See `CURSOR_MASTER_PROMPT.md` for the full product spec
and `docs/` for architecture, data model, implementation plan, integrations,
and privacy documentation.

**Status:** Phase 1 complete. Phase 2: open on **Today**. Bottom bar is
Today, a center **Talk** mic, and All. Account is the profile icon.
Talk opens a glowing face (pause ends the turn, words appear as it
speaks, then the conversation stays up). Easy Wins sit on Today.
Guest login for phone testing.
The same screens are a native iPhone app in `ios/` (SwiftUI). It talks
to the live API. Safari can still drop the mic in the background; the
iPhone app uses Apple speech instead.
See `docs/implementation-plan.md`.

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

Open `http://localhost:5173`, tap **Try as guest** (sample tasks, no account),
or log in with `demo@example.com` / `password123` / register.

### 4. iPhone app (`ios/`)

Same account as the website. Requires Xcode and an iPhone.

```bash
open ios/Taskr.xcodeproj
```

1. In Xcode, select the **Taskr** target → **Signing & Capabilities** → **Team**: your Apple ID. A free personal team works.
2. Plug the phone in. Tap Trust on the phone.
3. Pick that phone as the run destination (not a simulator) and press Run.
4. First launch on the phone: **Settings → General → VPN & Device Management** → trust your developer certificate.
5. Allow the microphone and speech recognition prompts. Talk needs both.

A free Apple ID certificate lasts about 7 days. Run from Xcode again when the phone says the app is no longer trusted. The bundle id is `app.taskr.ios`. Display name is **Working Title**.

Simulator check (no signing):

```bash
xcodebuild -project ios/Taskr.xcodeproj -scheme Taskr \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build
```

## Project layout

```
CURSOR_MASTER_PROMPT.md   Full product specification
docs/                      Architecture, data model, plan, integrations, privacy
server/                    Node + TypeScript + Express + Prisma + Postgres API
web/                       React + Vite client (Safari draft; still the easy desktop path)
ios/                       Native SwiftUI iPhone app, same API
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
