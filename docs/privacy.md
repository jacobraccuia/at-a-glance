# Privacy & security (Phase 1 baseline)

## Phase 1 commitments
- Passwords hashed with `bcrypt` (never stored or logged in plaintext).
- Sessions via signed, `httpOnly`, `secure`-in-production cookies.
- All task/bucket/goal/event queries scoped to `req.session.userId`; no
  endpoint trusts a client-supplied user id for data access.
- No third-party data sharing of any kind in Phase 1 — there are no external
  integrations yet.
- Local dev database runs in Docker, not exposed beyond localhost by default.
- `.env` holds secrets (DB connection string, session secret); `.gitignore`
  excludes it. `.env.example` documents required vars with placeholder
  values.

## Carried forward for later phases (not yet implemented, documented so they aren't forgotten)
- OAuth tokens (calendar, email) encrypted at rest, least-privilege scopes,
  explicit revocation UI, and deletion on disconnect.
- Minimize ingestion of message bodies/confidential work content; redact or
  avoid persisting raw external message text where not essential.
- Treat all imported external content (email, DMs) as untrusted input —
  guard against prompt injection before any LLM processing of it.
- No training of third-party models on user content without explicit,
  separate consent; accurately describe whichever provider is actually
  configured (no blanket claims).
- Account data export and deletion endpoints (GDPR-style), with reasonable
  retention limits on event logs.
- Work vs. personal visibility must be independently toggle-able once
  work-context features exist.
- Accessibility: Dynamic Type, VoiceOver, reduced motion, contrast — required
  for the native iOS app in Phase 3; the Phase 1 web client should still use
  semantic HTML and sufficient contrast as a baseline.
