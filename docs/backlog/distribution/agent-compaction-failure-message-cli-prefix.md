---
area: distribution
status: draft
title: Compaction failure text carries the CLI's reason prefix
created: 2026-11-23
why: external review of PR #423 (pre-existing on main) — CLI says "Auto-compaction failed:" / "Context overflow recovery failed:"
user_story: As a chat user, I want the same compaction failure wording as pi, but today rifty's compaction end event carries the bare summarizer error
epic:
blocked_by: []
sources: [ADR-0473, ADR-0569]
code: [packages/agent/src/continuation.ts]
---

## Context

CLI `_runAutoCompaction` (core/agent-session.ts ~3387) prefixes `errorMessage` by
reason. Rifty's `compactJournal` failure event emits the scrubbed raw error. The parity
suite does not compare that text. Pre-existing at 11b9397ee.

## Challenge

challenge: 2026-11-23 — not run (draft)
