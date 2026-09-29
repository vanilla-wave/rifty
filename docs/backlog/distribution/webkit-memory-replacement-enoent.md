---
area: distribution
status: draft
title: WebKit memory-backed replacement scenarios fail with ENOENT
created: 2026-09-28
why: two existing no-COI replacement scenarios fail while accessing expected project paths when native OPFS is unavailable
sources: [ADR-0469, docs/backlog/playground/reference/browser-floor-cross-engine-evidence.md, docs/backlog/playground/reference/no-coi-lane-firefox-webkit-evidence.md]
code: [tests/no-coi/no-coi-pi-agent.spec.ts, tests/no-coi/no-coi-resident-exit.spec.ts]
---

## Context

Finding. Manual CI run 36356372850, WebKit 26.4 on Ubuntu (persistent context;
native OPFS APIs absent): Pi hard Stop replacement reports `ENOENT:
/agent-stop`; resident restart/exit scenario reports `ENOENT:
/resident/node_modules/.bin/local-server`. Both are existing behavioral tests,
not assertions demanding OPFS. Exact failing sub-operation and the recovery
cause remain unisolated; do not attribute all WebKit reds to persistence.
The earlier macOS ephemeral-context run recorded the same two errors.

Owner: SDK/runtime recovery. Trigger: WebKit memory-tier fidelity work;
reproduce on Chromium with genuinely unavailable native storage at pickup.
Record-only by the browser-support-floor user; outside that goal.
Dedup: `distribution/no-coi-command-snapshot-transfer` concerns recovery-copy
cost, not this correctness failure; prior cross-engine evidence had no item.
