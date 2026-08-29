---
area: distribution
status: draft
title: no-COI build loop — sandbox composition for real Vite 7 + loud capability gate + no-COI CI lane
created: 2026-08-28
epic: no-coi-sandbox-tier
why: the real-Vite composition (esbuild-wasm adapter, bin execution, npm/shell wiring) exists only behind workbench COI gates; the sandbox tier needs the same loop composed in the single worker, a capability report making every gap loud, and a CI lane that serves NO COOP/COEP — today zero browser lanes do
user_story: As an agent platform, I want createSandbox → install → vite build → dist on a headerless page with a report naming what throws/degrades, but today the composition throws at the workbench gate and no lane proves any of it
sources: [ADR-0316, docs/backlog/runtime-js/reference/no-coi-degradation-probes.md, distribution/iframe-embed]
code: [packages/rifty/src/sandbox.ts, packages/workbench/src/workers/vite-esbuild-runtime.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/os.ts]
---

## Context

Build spike proved the loop end-to-end in real no-COI Chromium (78-pkg install, vite build,
byte-identical artifacts) but via throwaway harness hacks (deep workbench-internal imports,
manual global install). This item is the honest composition: sandbox-surface wiring of the
esbuild adapter + `.bin/vite` execution via runNodeEntry, the loud capability gate/report
(enumerates working / degraded-warn / throwing: execSync throw, spawn same-realm warn-once,
worker_threads polyfill warn, cpus→1, Vite-8/Rolldown loud named error — never a wasm crash),
and the no-COI Playwright lane (page served without COOP/COEP) that becomes the acceptance
vehicle for the whole epic. Degradation shape is user-decided (epic goal.md Decisions);
fidelity rule: no silent lie — the report is the single place an embedder/agent reads the
tier contract from.

Verified 2026-08-29 (real no-COI Chromium 148, bare-sab-guard sweep): kernel PUBLIC
`createSabRing()` throws raw `ReferenceError: SharedArrayBuffer is not defined`
(same class: `spawnKernelWorker` → spawn-worker.ts:395, `createWorkerOutputState` →
worker-stdio-drain.ts:119) — the capability gate/report here must turn these raw
crashes into named loud outcomes (evidence:
`runtime-js/reference/no-coi-degradation-probes.md` §2026-08-29 row 12).

Reachability obligation (bare-sab-guard checkpoint-2 G1, 2026-08-29): the public
`@riftydev/runtime-js/worker` entry installs NEITHER `installNodeRuntime` NOR
`installWorkerRealmCompat` (kernel pre-entry hook only — install-process.ts:125,
workbench kernel-worker-entry). This slice's composition installs the Node
runtime in the tier's realm; its Contract+RED must certify the ORGANIC
`createSandbox`→npm-install path exercises the (fixed) realm-compat shims —
the helper-level probe alone never proves SDK reachability.

## Challenge

challenge: 2026-08-28 — 1 problem
- Cheaper-route question the epic itself recorded is unsettled before the biggest slice: map.md §Open questions says a coi-serviceworker header-faking shim probe (minimal static page + SAB probe, near-zero cost) could deliver full COI on GH-Pages-class hosting and 'collapse part of this tier's hosting value', yet build-loop — the composition + gate + report + CI lane centerpiece — carries no ordering requirement to run that probe first, so the epic's largest investment lands while the cheap experiment that sizes its value share stays unrun.

<!-- Post-challenge edit: the shim probe is now a hard PICKUP prerequisite of this slice
     (map item 4); a value-collapsing probe result is a re-fit trigger. -->
