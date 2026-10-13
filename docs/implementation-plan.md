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

## Phase 2 — Assistant (primary surface live)

**Built and tested** (quick-capture is now AI-assisted, with a deterministic
fallback when no API key is configured or the call fails/times out):
- [x] `server/src/lib/assistant/intentParser.ts` — structured-output call to
      OpenAI (`gpt-4o-mini`, Zod-validated JSON schema via
      `zodResponseFormat`) that extracts: a cleaned-up title, a best-matching
      bucket (only from this user's *existing* buckets — never invents one),
      importance, estimate minutes (only if explicitly stated), waiting-on,
      and a rough date as a *day-offset integer*, never an absolute date —
      the server does all date arithmetic deterministically, not the model.
- [x] Quick-capture (`POST /tasks/quick-capture`) uses the parser when
      available. On any failure (no key, timeout >6s, malformed response,
      network error) it silently falls back to the exact old Phase 1
      behavior — title = raw text, no fabricated fields. This is the
      "deterministic command execution layer separate from LLM parsing"
      requirement: the parser only *suggests*; this route decides what's
      actually written to the DB.
- [x] AI-set dates are always `deadlineSource: "inferred"`, never
      `"explicit"` — "explicit" is reserved for dates a user set directly via
      the Details panel. Per the master prompt: never invent a hard
      deadline; distinguish explicit from inferred dates.
- [x] An explicit user action (tapping "Add to Today") always overrides any
      AI-suggested date.
- [x] Tasks created via the assistant path are tagged `origin: "assistant"`
      (vs `"manual"`) in the existing audit trail.
- [x] Explainability: no new UI was needed for this — the existing task-row
      pills (bucket/importance/deadline/estimate) already surface whatever
      the assistant inferred, and it's editable via the existing Details
      panel like anything else. Dismissible/correctable, not a black box.
- [x] Tests: 2 new integration tests mock the parser (no real API calls in
      CI — deterministic, free, fast) to verify bucket resolution, date math,
      origin tagging, and the "explicit addToToday wins" rule. All 9
      pre-existing tests still pass unmodified with no API key configured,
      proving zero regression to the deterministic fallback path.
- [x] **Multi-intent capture**: one quick-capture submission can now produce
      *several* tasks, not just one. `parseMultiCaptureText()` lets the
      model decide whether the input is one task or several (line breaks,
      "and"/commas joining distinct actions, back-to-back statements all
      count) and extracts the same per-task fields independently for each
      one (capped at 20). The quick-capture box is now a multi-line textarea
      (Enter submits, Shift+Enter for an explicit new line) so it reads as
      "dump everything, I'll sort it out" rather than one-task-at-a-time
      form filling.
  - [x] Deterministic fallback (no API key / AI failure): splits the input
        on newlines into one task per non-empty line, capped at 20 lines —
        zero AI involvement, zero invented fields, identical in spirit to
        the single-task fallback. A single line with no newlines still
        produces exactly one task, byte-for-byte the original Phase 1
        behavior.
  - [x] `POST /tasks/quick-capture` now always returns an array (even for a
        single task) rather than branching response shapes.
  - [x] Tests: 2 new integration tests — one exercising the real
        newline-based deterministic fallback (no mock), one mocking a
        3-item AI split and asserting each task's fields stayed independent
        (importance/estimate/deadline didn't leak between tasks). 22/22
        total passing.
  - [x] No separate "review before create" step — tasks are created
        immediately like single-capture always has been; reviewing/fixing a
        bad split happens via the normal editable task list (swipe, Details
        panel, inline rename), by explicit user choice over adding a
        blocking confirmation screen.

**Conversational assistant (the real product surface — not a dictation bar):**
- [x] `AssistantConversation` / `AssistantMessage` models + migration; chat
      history persists per user.
- [x] `POST /api/assistant/message` — shared text/voice intent pipeline.
      Model returns a structured plan (`create_tasks`, `complete`, `drop`,
      `snooze`, `reopen`, `add_to_today`, `list`, `clarify`, `none`); a
      separate deterministic executor resolves task references and writes
      to the DB. Model never touches SQL.
- [x] Entity resolution: free-text task queries matched against open tasks
      (title containment / token overlap). Ambiguous matches → clarify,
      never guess the wrong task.
- [x] One-tap undo for complete / drop / snooze / reopen via
      `POST /api/assistant/undo`.
- [x] Clarifying questions when the model (or resolver) is unsure.
- [x] Chat UI at `/assistant` (default post-login route, first nav item) —
      ChatGPT-style thread, suggestion chips, sticky composer.
- [x] Mic lives on the **assistant** composer (Web Speech API), not on
      Today quick-add. Quick-add remains a text-only fast dump.
- [x] No-AI fallback: raw message becomes a create_tasks dump so the
      assistant stays usable without an API key.
- [x] Tests: unit tests for task resolution; integration tests for
      drop+undo, multi-create via mocked plan, and no-AI fallback.

**Still deferred within Phase 2 (not claiming these are done):**
- [ ] "Quick tidy-up" review queue (How long will this take? Still waiting?)
- [ ] Easy Wins surfacing ("I have 25 minutes…")
- [ ] Natural-language recurrence creation ("Every Monday remind me…")
      via the assistant (recurrence still works through the All-tasks form)
- [ ] Estimate-correction learning signal / `LearnedPreference` /
      `LearningSignal` models
- [ ] Telemetry on estimate corrections
- [ ] Server-side Whisper if Web Speech proves flaky on a device
- [ ] Siri / Watch — needs native app (Phase 3)
- [ ] Open loops, calendar-aware scheduling — Phases 4/5

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
