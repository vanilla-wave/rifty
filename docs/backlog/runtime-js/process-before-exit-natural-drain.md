---
area: runtime-js
status: draft
title: beforeExit emission needs a natural-drain owner
created: 2026-10-02
why: Node emits beforeExit after natural drain; the Vitest goal explicitly excludes it
user_story: As a browser Node CLI developer, I want a beforeExit handler to schedule final work, but this lifecycle event is unclaimed.
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/vitest-before-exit-native-probe.mjs, docs/backlog/runtime-js/reference/vitest-before-exit-native-probe.txt, docs/adr/runtime-js/0491-node-lifecycle-handlers-and-referenced-worker-handles.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/workbench/src/workers/node-program-lifecycle.ts]
---

## Question

Which existing natural-drain owner should emit beforeExit and account for work
scheduled by its handlers? No implementation/carrier prescribed before pickup.

## Context

Native command: node docs/backlog/runtime-js/reference/vitest-before-exit-native-probe.mjs.
Actual Nodev24.16.0: BEFORE-EXIT0, then EXIT0. Current program lifecycle emits
exit only; beforeExit remains unclaimed. Source observation, not a new
runtime acceptance proof. The Vitest map explicitly excludes this event.
Dedup: process-lifecycle-events-exit-code carried this outside-goal note; separate
carrier preserves it when delivered handlers/exit item is closed. Late-rejection
and invocation-scoped-rejection items own different boundaries; no declined match.
Owner: runtime-js; trigger: CLI uses beforeExit to schedule final work.
