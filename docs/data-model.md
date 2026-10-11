# Data model (Phase 1 scope)

This document covers entities implemented in Phase 1. Entities named in the
master prompt but belonging to later phases (ScheduleSuggestion,
AssistantConversation/Message, LearningSignal, LearnedPreference,
IntegrationConnection, ExternalMessage, ExternalThread, OpenLoop,
NotificationDelivery, CalendarEventCache) are documented but not implemented
yet; their tables will be added in the phase that needs them so the schema
never carries dead weight.

## Phase 1 entities

### User
- `id` (uuid, pk)
- `email` (unique)
- `passwordHash`
- `displayName`
- `createdAt`, `updatedAt`

### UserPreferences
- `id` (uuid, pk)
- `userId` (fk -> User, unique — 1:1)
- `timezone` (IANA string, e.g. `America/New_York`)
- `weekStartsOn` (0=Sun..6=Sat)
- `createdAt`, `updatedAt`

### Bucket
- `id` (uuid, pk)
- `userId` (fk -> User)
- `name`
- `color` (hex string, nullable)
- `icon` (string identifier, nullable)
- `sortOrder` (int)
- `archivedAt` (nullable timestamp)
- `createdAt`, `updatedAt`
- Unique: (`userId`, `name`) while not archived — enforced at application layer (Prisma doesn't do partial unique constraints portably without raw SQL; documented here, handled in service layer + a partial unique index via raw migration SQL).

### Goal
- `id` (uuid, pk)
- `userId` (fk -> User)
- `title`
- `description` (nullable)
- `status` (`active` | `completed` | `archived`)
- `createdAt`, `updatedAt`

### Task
- `id` (uuid, pk)
- `userId` (fk -> User)
- `bucketId` (fk -> Bucket, nullable — inbox/uncategorized if null)
- `goalId` (fk -> Goal, nullable)
- `title`
- `notes` (nullable)
- `origin` (`manual` | `assistant` | `import` — Phase 1 only uses `manual`)
- `status` (`captured` | `active` | `completed` | `dropped`)
- `attentionDate` (soft "when to look at this", nullable, date or datetime)
- `plannedWindowStart` / `plannedWindowEnd` (nullable datetimes)
- `hardDeadline` (nullable datetime)
- `deadlineSource` (`explicit` | `inferred`, nullable — never set to a hard deadline unless `explicit`)
- `estimateMinutes` (nullable int)
- `estimateConfidence` (`low` | `medium` | `high`, nullable)
- `actualMinutes` (nullable int, sum of logged effort)
- `importance` (`low` | `medium` | `high`, default `medium`)
- `waitingOn` (nullable string — person/dependency description, Phase 1: free text only)
- `recurrenceRuleId` (fk -> RecurrenceRule, nullable)
- `snoozedUntil` (nullable timestamp — does not alter `hardDeadline`)
- `completedAt` (nullable timestamp)
- `droppedAt` (nullable timestamp)
- `createdAt`, `updatedAt`

Note: a recurring **Task** is the template; completable instances are
**TaskOccurrence** rows. A non-recurring task still gets exactly one implicit
occurrence concept handled via `completedAt` directly on Task for simplicity
in Phase 1 (avoids a join for the common case), while recurring tasks delegate
completion entirely to TaskOccurrence rows (template task itself is never
marked completed).

### RecurrenceRule
- `id` (uuid, pk)
- `frequency` (`daily` | `weekly` | `monthly`)
- `interval` (int, default 1)
- `byWeekday` (int[] nullable, 0=Sun..6=Sat, for weekly)
- `byMonthday` (int nullable, for monthly)
- `startDate` (date)
- `endDate` (nullable date)
- `createdAt`, `updatedAt`

### TaskOccurrence
- `id` (uuid, pk)
- `taskId` (fk -> Task)
- `occurrenceDate` (date — the date this occurrence applies to)
- `status` (`pending` | `completed` | `skipped`)
- `completedAt` (nullable timestamp)
- `createdAt`, `updatedAt`
- Unique: (`taskId`, `occurrenceDate`)
- Completing today's occurrence never touches tomorrow's row — each row is independent.

### TaskEvent (append-only audit log)
- `id` (uuid, pk)
- `taskId` (fk -> Task)
- `userId` (fk -> User — actor)
- `type` (`created` | `updated` | `completed` | `uncompleted` | `snoozed` | `dropped` | `reopened` | `archived`)
- `payload` (jsonb — before/after diff or relevant fields)
- `createdAt`

## Indices (Phase 1)
- `Task(userId, status)`
- `Task(userId, bucketId)`
- `Task(userId, attentionDate)`
- `TaskOccurrence(taskId, occurrenceDate)` unique
- `TaskEvent(taskId, createdAt)`

## Timezone/DST handling
`UserPreferences.timezone` is authoritative for computing "today" and
generating occurrence dates. Occurrence generation runs in the user's
timezone; `occurrenceDate` is stored as a plain date (no time component) to
avoid DST edge cases shifting which calendar day an occurrence belongs to.
