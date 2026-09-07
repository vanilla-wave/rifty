---
kind: epic
status: ready
title: Download only the code needed to boot the no-COI SDK
created: 2026-09-07
value: A headerless SDK host boots without the TypeScript compiler, QuickJS WASM or install machinery; CI detects their return.
user_story: As a headerless host using the published SDK, I want eval and file IO before installing Vite 7 without downloading unused boot code, but today that code dominates the worker transfer.
tier: works
---

## Outcome

Implement all five items captured in PR #310 in one separate PR. The published
SDK's splitting-bundler path downloads code when used, preserves the existing
install/build/HMR/restore/restart scenario, and exposes the user's accepted
no-COI rewrite-engine degradation. Real packed tarballs and Chromium prove it.

## User scenario

1. A headerless host bundles the published SDK, service worker, generic worker
   and no-COI toolchain worker with ESM splitting enabled.
2. Boot the toolchain sandbox; use eval and file IO before the first install.
   Neither TypeScript, install/activation machinery nor QuickJS WASM is fetched.
3. Install the real Vite 7 dependency set, build, run dev/HMR, restore and restart
   through the existing no-COI SDK surface. Deferred code loads when needed.
4. Select `vmEngine: 'quickjs'` to restore the existing isolated vm engine;
   the no-COI default reports rewrite degradation. Generic defaults stay intact.
5. Run JavaScript CLI eval without the compiler; non-JavaScript eval retains
   its existing named gap/error behavior after lazy compiler loading.
6. CI measures four packed client artifacts, with absolute min/gzip budgets
   and headroom. Historical TS/io leaks fail; the size gate is absent from
   local `pr:check`.

## Invariants

<!-- Baseline d52ef8128: source splitting probe, Node v24.16.0/esbuild 0.28.0:
generic eager 4,288,909 B / 1,237,810 gzip, TS 3,569,521 B;
toolchain 4,579,173 / 1,325,147, TS 3,569,551 B.
Published io retention, unconditional QuickJS preload, eager install imports,
and absent budgets: docs/backlog/distribution/reference/no-coi-client-bundle-evidence.md;
current code rechecked at FIT. These static-closure observations undercount boot-triggered dynamic imports;
FIT challenge corrects the measurement, not the destination. -->

- I1. JavaScript-only worker boot and CLI eval do not load TypeScript; lazy
  classification preserves existing eval behavior and compiler-fetch failure
  throws an error identifying the failed compiler chunk.
- I2. No-COI toolchain boot/restart defaults to rewrite with no QuickJS WASM
  request; explicit quickjs loads it before readiness. Capability/compat docs
  disclose the engine degradation; generic defaults remain quickjs.
- I3. Published main/sw omit unused io implementations (at most 5 KB io input
  each); `initBackend` loads only for generic sandbox creation. Source worker
  wrappers remain side-effectful like their published counterparts.
- I4. Toolchain install/activation code loads only on first install/restore,
  without host knobs. Install, build, HMR, restore and restart remain working;
  failed chunk fetch rejects the request while eval/fs remain usable.
- I5. CI alone budgets the four artifacts' complete eager JS graphs (including automatic dynamic bootstrap) from real
  packed tarballs (minified and gzip); historical TS/io leaks trip a calibrated
  budget. The standing worker guard rejects TypeScript in eager chunks.

## Challenge

challenge: 2026-09-07 — 1 problems

- I5’s static-chunk closure undercounts boot transfer: `packages/workbench/src/workers/no-coi-toolchain-worker.ts:269` unconditionally imports the runtime worker before `toolchain-ready`. Read-only esbuild splitting probe confirms a separate 4,496 B `worker-entry-*.js` dynamic chunk excluded by that closure. Include boot-triggered dynamic imports and their static dependencies; exclude genuinely deferred compiler/install chunks. Otherwise “complete eager JS graphs” does not establish the claimed download budget.

## Decisions

- 2026-09-07 — user: "реализовать все итемы из него отдельным ПРом"; all five PR #310 items, one implementation PR.
- override: 2026-09-07 — all-items hand-off includes `no-coi-worker-install-lazy-split`, previously held draft by its cheaper-generic-worker challenge; no item dropped.
- 2026-09-07 — tier works: preserve accepted behavior and the two declared chunk-fetch fault outcomes; no broader persistence/concurrency redesign.
- 2026-09-07 — retained PR #310 user decision: rewrite default for no-COI toolchain only, quickjs opt-in, explicit degradation; superseding ADR required.
- 2026-09-07 — eager artifact includes entry, automatic runtime-worker bootstrap import, and all their static dependencies; excludes only genuinely first-use chunks.
- rejected route: generic worker alone — does not deliver Outcome's toolchain install/restore path or I4 within the same sandbox.
- rejected route: keep quickjs default and expose only an option — violates I2 and the recorded PR #310 user choice.
- rejected route: source-only bundle sizes — cannot prove I3/I5 published tarball behavior.
