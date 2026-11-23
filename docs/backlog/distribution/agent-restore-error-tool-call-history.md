---
area: distribution
status: draft
title: Restore a history whose last response is an error with a tool call
created: 2026-11-23
why: external review of PR #423 (pre-existing on main) — rifty rejects what pi CLI continues
user_story: As an embedder, I want to restore a transcript that ended with an errored response carrying a tool-call proposal, but today initialMessages throws while the pi CLI continues such a session
epic:
blocked_by: []
sources: [ADR-0466]
code: [packages/agent/src/history.ts]
---

## Context

`restoreMessages` refuses "incomplete aborted/error tool proposal" (`history.ts`, toolCall
case). Pi omits such proposals on the wire, and the CLI resumes these sessions. The
behavior already existed at 11b9397ee and is not part of the pi 1.6.0 upgrade. Next probe: a
CLI session file ending in `assistant(error, toolCall)` vs `createAgentSession`.

## Challenge

challenge: 2026-11-23 — not run (draft)
