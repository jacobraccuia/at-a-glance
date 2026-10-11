# Implementation plan

Tracking checklist. Check items off as they land with a passing test run.
Nothing is marked done without the user seeing the app run and tests pass.

## Phase 0 — Architecture and repo
- [x] Inspect repo (empty except master prompt)
- [x] Stack decision confirmed with product owner
- [x] `docs/architecture.md`
- [x] `docs/data-model.md`
- [ ] `docs/implementation-plan.md` (this file)
- [ ] `docs/integrations.md`
- [ ] `docs/privacy.md`
- [ ] README with exact local setup commands
- [ ] git repo initialized (done), `.gitignore`

## Phase 1 — Real core MVP
Backend (`server/`):
- [ ] Project scaffold (TS, Express, Prisma, Docker Compose Postgres)
- [ ] Prisma schema: User, UserPreferences, Bucket, Goal, Task, RecurrenceRule, TaskOccurrence, TaskEvent
- [ ] Migrations applied, seed script with demo user + sample buckets/tasks
- [ ] Auth: register, login, logout, session middleware, password hashing
- [ ] Bucket CRUD (create/rename/archive/reorder) with ownership checks
- [ ] Task CRUD (create/edit/complete/undo/snooze/drop/reopen/archive)
- [ ] Recurrence: create recurring task, generate TaskOccurrence rows, independent per-occurrence completion
- [ ] TaskEvent audit log written on every mutation
- [ ] Views/query endpoints: Today, Upcoming, All (search/filter), by Bucket, captured/inbox
- [ ] Goal linkage (optional goalId on task, basic goal CRUD)
- [ ] Basic progress stats endpoint (completed this week, active backlog count, per-bucket breakdown)
- [ ] Quick text capture endpoint (manual, no AI yet — deterministic parse of title only in Phase 1)
- [ ] Unit tests: recurrence occurrence generation, snooze does not touch hardDeadline, daily completion independence
- [ ] Integration tests: full CRUD + auth flows against real test DB

Client (`web/`):
- [ ] Vite + React + TS scaffold
- [ ] Login/register screens
- [ ] Today view (list, checkbox complete, snooze, inline edit)
- [ ] Buckets view (CRUD)
- [ ] All tasks view with filters/search
- [ ] Quick text capture input
- [ ] Basic progress stats display

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
