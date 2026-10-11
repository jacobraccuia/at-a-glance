# Cursor Master Build Prompt — Adaptive Personal Assistant

You are the principal product architect, senior full-stack engineer, iOS engineer, AI systems engineer, and pragmatic product designer for this project. Build a working, production-minded application incrementally, not a static mockup. Read this entire specification before coding. Inspect the existing repository first, preserve good existing work, document decisions, and implement vertical slices with tests. If no repository exists, scaffold one.

## 1. Product thesis

Create a calm, low-friction, adaptive personal assistant that reduces the cognitive burden of remembering, sorting, and following up on life's commitments. The promise is breathing room: the app remembers and organizes things so people can spend their attention on living, creating, and actually getting things done. It should measurably improve follow-through without requiring constant administration. AI is quiet infrastructure, not the brand story or a flashy gimmick. The system should adapt to individual behavior, not force users into a rigid productivity methodology.

Working product name: `Working Title`. Working assistant name: `Assistant`. NEVER hardcode the joke name “Diwata” anywhere. Make both product and assistant display names configurable from one central branding configuration, with localization-ready strings, and avoid embedding names in persistent identifiers, API routes, database table names, or bundle identifiers. Provide safe migration instructions for changing app display name and bundle identity later.

Principles:
- Capture now, clarify later; details can also be supplied at capture time.
- One thought, one action. Voice and text use the same assistant intent system.
- The assistant holds everything relevant; the home screen shows only what needs attention.
- No deadline does not mean unimportant; overdue does not mean a wall of red.
- User-defined rules always outrank learned suggestions.
- Learn from explicit corrections and actual behavior, but never pretend to know more than evidence supports.
- Reduce notifications and management overhead, not merely task completion time.
- Everything AI suggests should be explainable, dismissible, and correctable.
- Work and personal data are separable; never assume the app should ingest an employer's full task universe.
- Privacy, transparency, and trust are product features.

## 2. Target platforms and technical approach

Prioritize iPhone as the primary experience, including native iOS Lock Screen Live Activities, widgets, Siri/App Intents, notifications, and share-sheet capture. Build a working end-to-end MVP with a pragmatic backend and a native iOS shell or native iOS app. Prefer SwiftUI for a genuine iOS experience and ActivityKit/App Intents; use a backend stack that is easy to maintain and deploy (e.g. TypeScript, PostgreSQL, Prisma/Drizzle, and a secure job queue). You may propose an alternative if you explain specific tradeoffs first. Do not represent a PWA as equivalent to native iOS Live Activities or App Intents. Develop against simulator first and document device-only testing requirements. Use a clean modular architecture so Android, web, and future connectors can be added later.

If starting in an empty repo, begin by writing `docs/architecture.md`, `docs/implementation-plan.md`, `docs/data-model.md`, `docs/integrations.md`, `docs/privacy.md`, and a README with exact local setup commands. Implement code in testable slices, not one giant unreviewable generation. Make the app useful without any external AI API key using deterministic fallbacks and mock connectors; enable LLM-powered interpretation through an adapter once credentials are configured. Never fabricate successful integrations.

## 3. Core entities and task lifecycle

Design a durable relational data model with migrations, ownership boundaries, and event history. Core entities include User, UserPreferences, Bucket/Category, Goal, Initiative/Project, Task, TaskOccurrence, RecurrenceRule, ReminderRule, TaskEvent, TaskEstimate, ScheduleSuggestion, AssistantConversation/Message, LearningSignal, LearnedPreference, IntegrationConnection, ExternalMessage, ExternalThread, OpenLoop, NotificationDelivery, and CalendarEventCache. Avoid redundant entities if the schema can stay clear and normalized.

Tasks support: title, notes, origin/source, bucket(s), optional project/goal, status, soft attention date, optional planned window, optional hard deadline, deadline confidence/source, estimated effort and confidence, actual effort where available, urgency, impact, importance, effort, energy/context requirements, waiting-on person or dependency, links/attachments, recurrence, notification overrides, timestamps, and provenance. Distinguish explicitly specified dates from inferred dates. Never invent hard deadlines. Do not equate task age with urgency automatically.

Lifecycle: captured/inbox -> active -> completed or dropped. Snoozed, waiting, and stale are temporary attributes/states; overdue is a derived condition, not a punitive primary status. Include undo, reopen, edit, archive, and recurring occurrences with independent completion history. Completing today's daily practice must not complete tomorrow's occurrence. Snoozing must not silently move a true hard deadline. Stale tasks prompt a gentle keep, revise, snooze, or drop review. Keep an append-only audit/event log for changes and AI actions.

Buckets are first-class user-created categories from day one, with starter examples Personal and Work, and user-defined examples like Drop Party, Party with Friends, House, Clients, Relationships. Support rename, archive, color/icon customization, ordering, and filters. Avoid deep folder trees. Goals and initiatives are optional higher-level objects linked to tasks; never force a goal on every task.

## 4. Primary home screen and navigation

The default home is a calm, clean, highly legible 'Today' view, not a dashboard of anxiety:
1. Date/day header and a brief, useful orientation sentence.
2. 'At a glance' with about three high-value actionable items selected using transparent rules, balancing true deadlines, importance, and feasible quick wins.
3. Today's full active list with checkboxes, inline edit, swipe snooze, and collapsed completed section (e.g. '5 done').
4. Easy Wins module: 'Have 20 minutes?' with a few realistic tasks, ideally under 15 minutes each, adjustable time budget.
5. Small evidence-of-progress summary, e.g. tasks completed this week and creative practice days; no guilt framing.
6. Persistent, prominent assistant control supporting voice and text, not merely 'add task'.

Provide a non-linear navigation structure with Today, Upcoming/Week, Buckets, Goals/Progress, and Assistant/Inbox (exact grouping may evolve based on usability). Support a comprehensive but quiet all-tasks view with search and filters, and a distinct 'Needs clarification' review queue. Work and personal visibility should be individually controllable.

Lock Screen: implement a genuinely native ActivityKit Live Activity showing a concise morning/day summary and deep-linking into Today. Research and respect actual ActivityKit lifecycle, entitlement, refresh, push, and OS limitations; a Live Activity is not guaranteed to persist indefinitely or start automatically every morning. Provide a widget and/or notification fallback when a Live Activity cannot legally or reliably run. Never promise always-on lock-screen presence.

## 5. Universal conversational assistant

One assistant entry point should understand statements and requests such as:
- 'I need to drop the UPS package off sometime this week.' -> create a task, no fabricated deadline.
- 'I just watered the plants.' -> complete the matching task/occurrence if confident; otherwise confirm.
- 'Every Monday remind me to call Mom.' -> create a recurring task/reminder.
- 'I have 25 minutes before my next meeting.' -> suggest easy wins compatible with calendar and context.
- 'Snooze that package until Thursday.' -> resolve reference and snooze without altering hard deadline.
- 'I need to finish the operations table before next week.' -> capture and distinguish vague timing from a strict due date.
- 'What have I actually accomplished this month?' -> summarize real activity with citations to app records.
- 'Don't remind me about personal tasks during work meetings.' -> set an explicit preference.
- 'That will take three hours, not thirty minutes.' -> correct estimate and save learning signal.
- 'Check whether everyone answered about the gig, then remind me to reply to the promoter.' -> create a waiting/open-loop workflow, with automation limited to connected/authorized sources.

Support free-form voice dictation, transcription review when low confidence, multi-intent messages, structured intent extraction, entity resolution, clarifying questions only when needed, and safe confirmation before consequential actions. Maintain conversation context but do not allow vague language to modify the wrong task. Show what changed and allow one-tap undo. Make assistant actions idempotent to avoid duplicate tasks after retries. Build a deterministic command execution layer separate from LLM parsing. No model should directly write arbitrary SQL or execute unvalidated tools. Provide structured JSON schemas and validation for all model outputs.

## 6. Capture, inbox, and clarification

Capture must work from a large assistant button, keyboard, Siri/App Intents/Shortcuts, iOS share sheet, and quick-add surfaces where feasible. Minimize steps. Support rich descriptions without forcing a form. Infer likely bucket, task type, effort, and next-attention time with confidence scores. If a detail is nonessential, do not interrupt capture. Later surface a compact 'Quick tidy-up' queue: 'How long will this take?', 'Still waiting on the band?', 'Do you still need this?', 'Did you make progress?' Allow voice conversational review and fast visual taps. Batch questions, respect deferral, and avoid repeatedly asking the same thing.

## 7. Scheduling and calendar intelligence

Support optional read-only calendar connection first, with explicit scopes and consent. Ingest free/busy windows and event context only to the degree authorized. Propose realistic work windows based on duration, travel/location if explicitly available, meeting preparation needs, working hours, personal preferences, and buffer time. Examples: suggest Wednesday 1–4 PM for the post office if free, or a short meeting-prep block before a consequential meeting. Never assume calendar gaps are truly free, never silently create calendar events, and do not claim awareness of traffic, store hours, or travel times without grounded external data. Allow approve/dismiss/reschedule and learn from decisions. Keep manual scheduling functional without calendar access.

## 8. Prioritization, easy wins, and learning

Build a transparent rules-based ranking baseline: hard deadlines, user importance, task dependencies, age/neglect as a weak factor, user attention date, calendar feasibility, and estimated effort. AI can provide a suggested ranking and explanation but must not override explicit user priorities. Avoid a single opaque 'intensity' number as the only mechanism. Separate 'important', 'needs attention now', and 'quickly actionable'.

Estimate effort from task type, bucket, history, and explicit corrections. Preserve raw estimates and actuals. On correction ('30 minutes' -> '3 hours'), update that task immediately and store a contextual learning signal; apply cautiously to similar future tasks, not all tasks. Learn response windows, snooze patterns, frequently preferred work periods, recurring routines, and helpful versus unhelpful notifications. Explicit preferences trump inferred preferences. Use conservative sample-size thresholds, recency weighting, confidence, and a cold-start fallback. Provide a 'What I've learned' screen with evidence, edit/reset/delete controls and an option to disable personalization. Never imply that an LLM call alone constitutes durable learning.

## 9. Notifications and gentle proactivity

Support hard deadline reminders, flexible nudges, waiting-on follow-ups, task aging reviews, morning brief, and optional end-of-day reflection. Users may set rules such as one day and one hour before deadlines; preserve those rules exactly. Allow quiet hours, work/personal boundaries, per-bucket overrides, snooze, digest frequency, and easy global pause. Optimize suggestions based on observed engagement, but do not assume dismissals mean irrelevance (user may be in a meeting). Track deliveries and outcomes; cap notification frequency and deduplicate. Separate critical reminders from optional coaching. Provide concise explanations: 'You asked to be reminded one hour before' versus 'Suggested because you have an open afternoon'. Require opt-in for proactive recommendations and notification permissions.

## 10. Open loops: messages, gigs, and follow-ups

Treat an 'open loop' as an unresolved commitment, unanswered question, pending external response, or follow-up, distinct from an ordinary task. Example: a promoter DMs 'Can Drop Party play Friday?' -> user checks band availability -> waits for replies -> needs to respond to promoter. Model linked participants, source thread, waiting-on condition, last activity, follow-up attention date, resolution, and manual override.

The desired future experience is automatic detection of important outstanding email/DM/text threads and follow-through. HOWEVER, integration feasibility is platform-dependent. Build a connector abstraction with capability discovery and explicit permissions. Phase 1: manual share-sheet capture, forwarded email or supported email provider integration, and optionally authorized email scanning for likely actionable threads. Do not promise direct scanning of Instagram DMs, Facebook Messenger, personal SMS/iMessage, or Teams where APIs/platform rules prohibit or restrict it. No scraping, credential collection, private API abuse, or circumventing access controls. Use user-confirmed open-loop suggestions; don't automatically convert every message into a task. Phase 2: provider-permitted thread progress tracking, detecting replies and updating waiting-on status. Maintain deep links to source conversations where supported. Work account integration is strictly opt-in and must honor employer policy. Never send messages or reply on the user's behalf without explicit approval.

## 11. Reporting and meaningful progress

Per bucket and overall: completed tasks, active backlog, average/median time to completion, aging, overdue trends, snoozes, estimated versus actual effort where known, recurrence consistency, and progress on linked goals. Show meaningful comparisons only with enough data and caveat incomplete capture. Example: 'You practiced music 12 days this month' is stronger than a hollow streak. Focus on evidence of progress, not guilt or fake productivity scores. Show how the app is helping through measurable signals, but do not claim causal improvement without adequate evidence. Let users reflect at end of day by speaking what they accomplished, and reconcile it to existing tasks without duplicates.

## 12. Security, privacy, reliability, and accessibility

Implement authentication, secure token storage, encryption in transit and at rest where applicable, per-user authorization checks, OAuth least privilege, revocation, deletion/export, retention limits, and clear permissions for calendar/email. Minimize ingestion of message bodies and confidential work information. Never train third-party models on user content without explicit consent; describe external model data handling accurately based on selected provider. Treat imported messages as untrusted data; guard against prompt injection. Provide auditability and reversible AI actions. Offline task capture should queue and sync safely; account for timezones, DST, recurring events, deduplication, connectivity failures, and background execution limitations. Make notifications accessible and avoid dark patterns. Support Dynamic Type, VoiceOver, reduced motion, and contrast.

## 13. Delivery phases and acceptance criteria

**Phase 0 — Architecture and repo:** Inspect codebase; decide stack; define data model, design tokens, branding config, milestones, and test strategy. Produce docs and running local setup.

**Phase 1 — Real core MVP:** Authentication/local development identity; user-created buckets; task CRUD; recurring dailies with occurrence-level checkoffs; complete/undo; snooze; today/upcoming/all/bucket views; captured versus active versus waiting; goal linkage; event history; quick capture via text; basic progress stats. Persist to real database. Include seed data and tests.

**Phase 2 — Assistant:** Shared text/voice intent pipeline, structured validation, safe task commands, natural-language recurrence, completion, snooze, quick tidy-up, easy wins, corrections, deterministic fallbacks, and conversational review. Add telemetry for estimate corrections and explanations.

**Phase 3 — Native iOS polish:** SwiftUI Today view, widgets, App Intents/Shortcuts, share extension, push/local notifications, ActivityKit Live Activity with documented limitations and fallback. Device testing checklist.

**Phase 4 — Adaptive guidance:** Calendar read-only integration, schedule suggestions, conservative personalization, notification preference rules, 'What I've learned', and gentle proactive briefings.

**Phase 5 — Open loops:** Manual share capture and an Open Loops inbox, supported email OAuth connector and actionable thread suggestions, waiting-on follow-ups, optional thread tracking only where permitted.

**Phase 6 — Advanced:** More connectors as legally/technically supported, cross-device sync, stronger analytics, advanced learning, additional platforms, and carefully permissioned calendar write actions.

For every phase: include implementation, migrations, tests, error/loading/empty states, accessibility checks, privacy/security review, and a demo path. Use real persisted data. Clearly mark unavailable integrations, simulated behavior, and unresolved platform limitations. Do not ship fake buttons or fabricated AI confidence. Run tests and report what passes, what fails, and what remains.

## 14. UX sample walkthroughs to validate

A. Morning: User taps Lock Screen summary -> Today opens -> sees 3 curated priorities, list, completed count, Easy Wins, and assistant input. The app is calm and useful in under 5 seconds.
B. Mid-meeting: User says 'Send that charger back sometime this week' -> captured in one action, categorized Personal, without deadline interrogation. Later app asks for details only if genuinely useful.
C. Evening: User says 'I watered the plants and practiced sax' -> existing occurrences are marked done, progress recorded, no duplicate tasks.
D. Recurrence: 'Every Monday call Mom' -> recurring task/reminder appears appropriately; one Monday's completion doesn't alter future occurrences.
E. Estimate correction: 'That takes three hours, not thirty minutes' -> immediate correction; next comparable task gets a more plausible estimate with editable rationale.
F. Overwhelm: User asks 'What can I do in 15 minutes?' -> 2–3 feasible easy wins, not a lecture or a wall of red tasks.
G. Calendar: A meeting is approaching -> with permission, assistant suggests optional prep, without inventing work commitments.
H. Gig offer: User shares a promoter DM -> app proposes an open loop, tracks 'waiting for band', prompts a follow-up at a reasonable time, and requires approval before sending any reply.
I. User changes assistant name in config -> all displayed names update, no database migration required.
J. Notifications: Explicit reminder rules are honored even when learned timing preferences differ.

## 15. Immediate instructions to Cursor

1. Read the entire specification and inspect the repository.
2. State the recommended architecture and any platform/API limitations that affect the vision, especially ActivityKit, Siri, email, and social DMs.
3. Write the documentation and an actionable implementation checklist with acceptance criteria.
4. Begin implementing Phase 1 immediately unless an essential blocking decision requires input. Choose sensible defaults and list them, rather than asking dozens of questions.
5. Keep the app running at the end of each vertical slice; include exact commands to launch it and run tests.
6. After Phase 1, summarize completed features and ask whether to proceed to the next phase. Do not claim later phases are complete before they exist.

Success is not the number of features. Success is a trustworthy assistant that users actually keep using because it makes their lives easier.
