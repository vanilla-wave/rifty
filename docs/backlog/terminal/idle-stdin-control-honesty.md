---
area: terminal
status: draft
title: Reject idle terminal stdin without a fake ACK
created: 2026-07-15
why: the legacy page terminal manager resolves idle stdin and EOF even though no owner run receives them
user_story: As a developer driving an interactive Node CLI, I want stdin completion to prove delivery to the active process, but today input after process exit is silently dropped as success.
blocked_by: []
sources: [ADR-0230, ADR-0264-sibling-sweep]
code: [apps/playground/src/adapters/terminal-manager.ts, apps/playground/src/adapters/terminal-manager.test.ts]
---

## Context

Unrelated sibling found while fixing ADR-0264 lifecycle ownership. `TerminalManager.writeStdin()` and `endStdin()` return resolved promises when the session is idle (`terminal-manager.ts`); no run id exists and no owner frame is sent. The test at `terminal-manager.test.ts` currently pins the late write as “dropped silently.” Fault class: `provenance-lie` — the Promise claims delivery without owner proof.

Refine the legacy/migration contract, then replace both idle success paths with one loud no-active-run outcome (expected `ClosedHandleError`), zero transport frames, and regression coverage for write + EOF after physical exit. Do not change active or pre-admission FIFO/ACK behavior.
