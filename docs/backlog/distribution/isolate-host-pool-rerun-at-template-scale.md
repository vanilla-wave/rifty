---
area: distribution
status: draft
title: Concurrent sandbox runs over a template are rerun by the worker's RSS watchdog after a momentary idle
created: 2026-11-25
why: With the template goal's states (~146 MB per run) about 12 % of concurrent calls run twice — all succeed, but their latency doubles and a second loss is `ERR_ISOLATE_HOST_WORKER_LOST`.
sources: [docs/backlog/epics/isolate-host-live-sandbox/goal.md, ADR-0563, PR-460-external-review]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-host/src/protocol.ts, packages/isolate-host/src/pool.ts]
---

## Context

Found by the external review of PR #460 (macOS, four-library template, default limits): 8 calls at
once — 37 / 15 / 5 / 14 reruns in series of 740; 4 sandboxes at once — 12 of 96; every rerun
succeeded; medians 1.5–2.8 s against 0.8–1.1 s. Mechanism, read from the code: when a worker is
momentarily idle the watchdog resets its admission (`child/main.ts`, `live.size === 0` →
`busyAllowanceMb = 0`), but the RSS a finished run left resident stays; the next call's ceiling
(`rssCeilingBytes([busyAllowanceMb])`, `protocol.ts`: 256 MiB + 3 × its limit) is below that RSS
(measured: RSS 3 943 MiB, ceiling 1 765 MiB, `live: 1`), so the worker dies and up to four queued
calls rerun alone (`pool.ts` `rerun`, one rerun within the original deadline). The rule predates
the template; template-scale states make it fire.

Repro: `node --expose-gc packages/isolate-host/scripts/measure-template.mjs <artifact>
--concurrent 8` (latency, workers' RSS; the rerun count needs a pool-side counter). Route: a fix
item — a failing reproduction first, then the admission rule.

Owner: distribution (isolate host). Trigger: a consumer running concurrent template sandboxes.

## Challenge

challenge: 2026-11-25 — none yet (capture)
