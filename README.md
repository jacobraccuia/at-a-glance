# Taskr

An adaptive personal assistant for tracking life's commitments without the
cognitive overhead. See `CURSOR_MASTER_PROMPT.md` for the full product spec
and `docs/` for architecture, data model, implementation plan, integrations,
and privacy documentation.

**Status:** Phase 1 complete. Phase 2: open on **Everything**. Bottom bar is
Today, a center **Talk** mic, and Everything. Account sets the home list
back to Today. A dated task shows its day. A clock shows only when one
was set. A sideways swipe has to be deliberate. Account is the profile icon.
Talk opens Puck. The mic starts immediately. A quiet call hangs up after
20 seconds. A named clock time stays on that day. Midnight means the day
only. A capture with no date goes to **Today**. Saying later stays Later.
The groups are Today, Tomorrow, Upcoming, and Later. Everything hides
completed tasks unless the filter is Completed. **Hide work** drops the
Work bucket until you turn it back on.
Every account starts with **Main**. It can be renamed and it cannot be archived.
Moving a task into a bucket teaches the next similar capture.
Guest login for phone testing.
The same screens are a native iPhone app in `ios/` (SwiftUI). It talks
to the live API. Siri: Ask Puck, Talk to Puck, and Tell Puck start the call.
Add to Tasker adds a task. Account can bias Puck toward tasks, both, or chat.
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
6. Allow notifications if you want the morning nudge. Account sets the time. It stays quiet when Today is empty, or when the app is already open.
7. Add the **Today** widget from the home screen or the lock screen. It shows how many are left and the easiest one. It updates when you open the app, and on its own about every half hour.
8. Start a task from its details, or tap **Start that one** on the morning note. That task stays on the Lock Screen until you tap Done or Stop. It does not stay up all day, and it does not start by itself in the morning.

A free Apple ID certificate lasts about 7 days. Run from Xcode again when the phone says the app is no longer trusted. The bundle id is `app.taskr.ios`. Display name is **Taskr**.

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
- Conversational Talk uses GPT-Live (`gpt-live-1.1`) when the key is set.
  Audio goes to OpenAI. The key stays on the server. Typed quick capture
  still works without a live session. Closing the sheet, or 20 seconds of
  silence, ends the call. A named clock time is stored on that day.
- iOS links WebRTC 158.0.0 from `ios/Vendor/WebRTC` (checksum
  `dd26ba28fb9c8dbc82f4be3085e8d112a4e2a4e654e1786a9977a748c24c4912`).
  The xcframework stays local. Fetch the release zip from
  `https://github.com/stasel/WebRTC/releases/download/158.0.0/WebRTC-M158.xcframework.zip`
  and unzip it next to `Package.swift`.
