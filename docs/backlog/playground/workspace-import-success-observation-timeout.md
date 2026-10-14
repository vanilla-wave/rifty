---
area: playground
status: draft
title: "Why does workspace import sometimes lack an observed success toast?"
created: 2026-10-14
why: Import setup can prevent a real Node program reaching its agent; failure versus notification race not isolated
sources: [docs/backlog/distribution/reference/agent-eval-pr341-rework.md, docs/backlog/distribution/reference/agent-eval-pr341-import-observer.json.gz]
code: [tools/agent-bench/src/lanes/rifty.ts, apps/playground/src/adapters/playground-app.tsx, packages/workbench/src/workers/playground-archive-integration.ts]
---

## Question

Why did all3 COI stringify-boxed imports in the corrected PR341 series miss
the success toast after90s, while the same fresh public import succeeded in
the isolated post-series observer? Actual import failure, readiness, and
notification ordering remain open; no speculative repair.

Path: Project files starter → Stop project → Import workspace archive →
original stringify-boxed corpus. Agent/tools/tokens never started in those3
rows; original outcomes retained.

Attempt: `pnpm exec tsx /tmp/pr341/diagnose-coi-import.mjs`, real Chromium,
same local npm transport, no model. Success; no page errors. Toasts: new
scratch, start exited by SIGTERM, import success. Earlier stop error is an
observation, not established timeout cause. Script/results in linked proof.

Dedup: root playground/distribution drafts, goal maps, traps and declined
concepts; no matching timeout question. Historical queue-clear2 import
timeouts remain separately unisolated. Boundary/axis unsettled; no new
coordination mechanism or ready promise.

Owner: playground/agent-bench. Trigger: reproduce via this public path or
change archive readiness/notification handling. Source SHA-1/alias repairs
do not claim this UI failure resolved.
