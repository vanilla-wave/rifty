---
area: kernel
status: draft
title: COI on Firefox 119–144 by polyfilling Atomics.waitAsync over a helper worker
created: 2026-09-27
why: the SAB IPC transport and the checkSandboxSupport shared-memory probe require `Atomics.waitAsync` (Firefox 145, 2025-11-11); Firefox 119–144 has COOP/COEP `credentialless`, SharedArrayBuffer and `Atomics.wait` in workers but is `unsupported` for COI today
sources: [ADR-0469, docs/backlog/distribution/reference/browsers-compat-matrix-evidence.md]
code: [packages/kernel/src/ipc/capabilities.ts, packages/kernel/src/ipc/sync-dispatch.ts, packages/kernel/src/worker-stdio-drain.ts, packages/workbench/src/support/check-sandbox-support.ts]
---

## Question

Whether a polyfill is worth it. Share at stake (research §4, StatCounter 2026-08 desktop; only 119–144 qualifies — ESR 115 has no `COEP: credentialless`): ESR 128 = 0.2 % RU / 0.6 % WW of Firefox desktop, ESR 140 = 1.8 / 2.9 — ≈ 2.0 % RU / 3.5 % WW of Firefox desktop (5.74 / 5.31 % of desktop) ≈ 0.11 p.p. RU desktop / 0.19 p.p. WW desktop; stable Firefox is on 156. Cost: `waitAsync` semantics (async wake on `Atomics.notify`, timeout, `not-equal` fast path) over a dedicated helper worker blocking in `Atomics.wait` and posting wakes; `sync-dispatch.ts:95-122` already has a busy-poll fallback for the no-`waitAsync` case, but `isSabIpcSupported` and `worker-stdio-drain.ts:296` refuse without it; the probe would need the same allowlist. Value decays as ESR 140 ages out; ESR 115 (Win7/8.1) never gains `waitAsync`. Outside `epics/browser-support-floor` — user 2026-09-27 "2a" (record only). Trigger: a host with a measured Firefox-ESR population needing `execSync`/SAB features.

## User scenario

A developer on Firefox ESR 140 opens the COI playground: today `checkSandboxSupport().modes.coi` is `unsupported` (`shared-memory` fails on `Atomics.waitAsync`) and `execSync` throws `NotImplementedError`; with the polyfill the COI workbench boots and sync child processes run.

## Out of scope

Firefox <119 (no `COEP: credentialless`); non-COI tier (unaffected, Firefox 115 floor).

## Decisions

- 2026-09-27 — recorded as question, not scheduled — user "2a"
