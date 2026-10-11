# Integrations

No external integrations are implemented in Phase 1. This document records
what's planned and the hard platform constraints that shape later phases, so
nothing gets promised that can't be delivered.

## LLM / Assistant (Phase 2+)
- The app must be fully useful with zero AI configured: deterministic
  fallbacks for capture (plain text -> title), completion (exact/fuzzy title
  match with confirmation), and recurrence (explicit form fields).
- An adapter interface (`AssistantProvider`) will be introduced in Phase 2 so
  a real LLM provider (OpenAI, Anthropic, local model, etc.) can be swapped in
  via config/env var without touching call sites. Never fabricate a
  successful AI response if no provider is configured — show deterministic
  mode explicitly in the UI.

## Calendar (Phase 4)
- Read-only, explicit OAuth scopes, user-initiated connect/disconnect.
- Candidate: Google Calendar API and/or Apple EventKit (iOS-local, no OAuth
  needed when running natively) depending on which calendar provider the user
  actually uses. Decision deferred to Phase 4 kickoff.
- Never silently create calendar events. Never assume a free slot means truly
  available (no traffic/travel-time data without a grounded external API).

## Email (Phase 5)
- Supported paths only: user-forwarded email, OS share-sheet capture, or a
  provider OAuth connector (e.g., Gmail API) with explicit, revocable scopes.
- No generic inbox scraping, no credential harvesting, no IMAP password
  storage as a first-class flow.

## Messaging platforms (Instagram DM, Facebook Messenger, iMessage/SMS, Teams)
- **No automatic scanning is planned or promised**, ever, unless a platform
  publishes a compliant, authorized API for this use case. These platforms
  either prohibit this kind of access or require business approval processes
  incompatible with a personal assistant app.
- The only supported path is **manual share-sheet / copy-paste capture** by
  the user, which is always available regardless of platform policy changes.

## Siri / App Intents / Shortcuts (Phase 3)
- iOS-only. Implemented via native App Intents framework once the SwiftUI
  app exists. Requires physical device testing for full verification
  (several Shortcuts/Siri behaviors don't fully work in Simulator).

## ActivityKit Live Activities (Phase 3)
- Not guaranteed to persist indefinitely or auto-start every morning without
  a push trigger or explicit user action (OS-level constraint, not a bug to
  fix later). A widget and/or standard notification fallback is required
  whenever a Live Activity can't legally or reliably run.
