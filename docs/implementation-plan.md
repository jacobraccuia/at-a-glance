# Implementation plan

Tracking checklist. Check items off as they land with a passing test run.
Nothing is marked done without the user seeing the app run and tests pass.

## Phase 0 — Architecture and repo
- [x] Inspect repo (empty except master prompt)
- [x] Stack decision confirmed with product owner
- [x] `docs/architecture.md`
- [x] `docs/data-model.md`
- [x] `docs/implementation-plan.md` (this file)
- [x] `docs/integrations.md`
- [x] `docs/privacy.md`
- [x] README with exact local setup commands
- [x] git repo initialized, `.gitignore`

## Phase 1 — Real core MVP
Backend (`server/`):
- [x] Project scaffold (TS, Express, Prisma, Docker Compose Postgres)
- [x] Prisma schema: User, UserPreferences, Bucket, Goal, Task, RecurrenceRule, TaskOccurrence, TaskEvent
- [x] Migrations applied, seed script with demo user + sample buckets/tasks
- [x] Auth: register, login, logout, session middleware, password hashing
- [x] Bucket CRUD (create/rename/archive/unarchive/reorder-ready) with ownership checks
- [x] Task CRUD (create/edit/complete/undo/snooze/drop/reopen)
- [x] Recurrence: create recurring task, generate TaskOccurrence rows (90-day horizon), independent per-occurrence completion
- [x] TaskEvent audit log written on every mutation
- [x] Views/query endpoints: Today, Upcoming, All (search/filter), by Bucket, captured/inbox
- [x] Goal linkage (optional goalId on task, basic goal CRUD)
- [x] Basic progress stats endpoint (completed this week, active backlog count, per-bucket breakdown)
- [x] Quick text capture endpoint (manual, no AI yet — deterministic parse of title only in Phase 1)
- [x] Unit tests: recurrence occurrence generation (9 tests), snooze does not touch hardDeadline, daily completion independence
- [x] Integration tests: full CRUD + auth flows against real test DB (7 tests, 16/16 passing total)

Client (`web/`):
- [x] Vite + React + TS scaffold
- [x] Login/register screens
- [x] Today view (list, checkbox complete, snooze, inline edit via double-click)
- [x] Buckets view (CRUD + archive/unarchive)
- [x] All tasks view with filters/search + inline task creation
- [x] Upcoming view (next 7 days)
- [x] Quick text capture input
- [x] Basic progress stats display

Manually verified end-to-end in a real browser against the real backend/DB
(login, complete/undo, buckets, recurrence) — see architecture doc for stack.
Not yet built (explicitly deferred, not Phase 1 scope): Easy Wins module,
"at a glance" curated picks, goal UI, drag-to-reorder buckets — these are
UX-polish items better suited to Phase 2/3 once the assistant and native
shell exist, so Phase 1 isn't duplicating UI work.

Exit criteria for Phase 1: user can register, create buckets, create one-off
and recurring tasks, see them in Today/Upcoming/All/Bucket views, complete,
undo, snooze, drop/reopen, see accurate progress stats — all persisted in
Postgres, all covered by passing tests, runnable locally via documented
commands.

## Phase 2 — Assistant (not started)
Deferred. Will add: shared intent pipeline, structured validation, safe task
commands, NL recurrence parsing, quick tidy-up queue, easy wins, estimate
corrections + learning signal, deterministic fallback mode, conversational
review, telemetry.

## Phase 3 — Native iOS polish (not started)
Deferred. SwiftUI Today view, widgets, App Intents/Shortcuts, share
extension, push/local notifications, ActivityKit Live Activity + documented
fallback, device testing checklist.

## Phase 4 — Adaptive guidance (not started)
Deferred. Calendar read-only integration, schedule suggestions, conservative
personalization, notification preference rules, "What I've learned" screen.

## Phase 5 — Open loops (not started)
Deferred. Manual share capture, Open Loops inbox, email OAuth connector,
waiting-on follow-ups, permitted thread tracking only.

## Phase 6 — Advanced (not started)
Deferred. Additional connectors, cross-device sync, stronger analytics,
advanced learning, additional platforms, permissioned calendar writes.
