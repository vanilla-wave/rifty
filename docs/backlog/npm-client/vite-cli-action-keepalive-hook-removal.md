---
area: npm-client
status: ready
title: The installed Vite `dist/node/cli.js` carries no rifty keepalive patch — the CAC action hook (`__riftyTrackCliPromise`) is removed once the Vite lanes prove it is not load-bearing
created: 2026-10-15
why: the hook pins Vite's whole un-awaited CAC action promise as one keepalive ref; it predates the generated esbuild client's own handle mapping (`runtime-service-refs` = upstream `child.ref()/unref()`), and a two-arm probe shows `vite build` completes identically with the hook inert — an adaptation with no named platform gap behind it is undeclared debt
user_story: As a developer running `vite build` on the Vite 7 starter, I want the installed `cli.js` to be the upstream 7.3.6 bytes and the build to exit when its real work is done, but today rifty rewrites `this.runMatchedCommand();` and re-validates that rewrite before every CLI start
epic: honest-guest-package-adaptations
blocked_by: []
sources: [ADR-0530, ADR-0174, ADR-0226, ADR-0384, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md]
code: [tools/shadow-registry/src/runtime/vite-cli-install-policy.ts, tools/shadow-registry/src/runtime/vite-cli-prep.ts, tools/shadow-registry/src/runtime/vite-node-entry-edge.ts, packages/workbench/src/workers/node-entry-runtime-preparation.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Finding (observed on `9645c62bf`; evidence
`docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md`
§Probe 1). `viteCliActionPatchPolicy` rewrites CAC's
`this.runMatchedCommand();` so the action promise reaches
`globalThis.__riftyTrackCliPromise` → `trackKeepalivePromise` (one keepalive
ref until settlement; rejection routed to the realm trap).
`validateCliActionPatch` refuses an unpatched tree before every action.

Origin `fdeefa15a` (2026-06-26, ADR-0174): at that time esbuild ran through a
WASI bridge with no handle mapping. Since ADR-0226 the generated client maps
esbuild's own `refs` onto the realm keepalive (`refs ??= runtimeRefs`,
`generate-esbuild-runtime.ts:155-159`) — the exact analogue of upstream
`esbuild/lib/main.js:2308-2311` `child.ref()/unref()`; fs streams ref via
counted timers; `fs.promises` settles on microtasks; `import()` is counted.

Probe: vite starter, terminal `vite build`, one run per arm — committed hook vs
`globalThis.__riftyTrackCliPromise = (p) => { void p; }` — identical output
(`✓ 7 modules transformed`, gzip rows, `✓ built in 122/135ms`, `dist/assets`
listed), no page errors. One run per arm on one starter: the hook is not
required on this path; a residual zero-ref window on larger inputs is not
excluded but has no evidence. This unit lands on its own Vite-lane
acceptance, independent of `runtime-js/keepalive-host-async-node-carriers`;
if a lane exposes a window, that carrier is routed to the keepalive item
(REV-12), never a reason to keep a package patch.

No ADR names the hook; ADR-0384's inventory
(`registry-package-adaptations-evidence.md:15`) lists it as "Vite CLI
promise/watch patches". Removal touches: the policy + both `apply`/`validate` paths,
`assertViteCliKeepalive`, `ViteCliPreparation.trackKeepalivePromise`,
`vite-node-entry-edge.ts`, `node-entry-runtime-preparation.ts`,
`no-coi-toolchain-worker.ts:65`, the `@riftydev/runtime-js` export
`trackKeepalivePromise` (cross-package public API → DEC-1 p1 ADR at pickup,
or a documented retention), `install-artifact-identity.json` + snapshot
re-bake (`pnpm snapshots:bake`, `check:snapshot-artifact-drift`), and
`tests/integration/vite-cli-prep.test.ts` rows asserting the patch.

Acceptance shape expected at pickup: installed `node_modules/vite/dist/node/cli.js`
byte-identical to the upstream tarball member for 7.3.6 (and the Vite 8 bundle);
`esbuild-vite-contract.spec.ts`, `vite7-build-preview.spec.ts`,
`react-vite-build.spec.ts`, `vite-command-honesty.spec.ts` and the Vite 8
build/preview lanes green with no hook present; `vite build` with a failing
`vite.config.js` still prints the error to stderr and exits 1 (today the hook
routes the action rejection to `handleRealmUnhandledRejection`, without it the
realm `unhandledrejection` trap does — ADR-0152 §3; same Node outcome, proven
by a row); the inventory row for this adaptation deleted.

Dedup: no title/`code:`/map/declined match.

## Challenge

challenge: 2026-10-15 — clear (goal premise, `epics/honest-guest-package-adaptations` §Challenge)

## Acceptance

Baseline: upstream tarball members (`vite-7.3.6.tgz` fixture; `npm pack vite@8.0.16`,
cli.js sha256 `369e1007…2c41`) and real Node 24.16.0 + vite 7.3.6 for the
failing-config row (`docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md`
§Item 2 oracle). RED on `aebdd7ddd`: rows 1-2 fail (patched bytes, `HOOK=function`).

1. Installed `node_modules/vite/dist/node/cli.js` of the Vite 7.3.6 and Vite 8.0.16
   starters is byte-identical to the upstream member; baked snapshots carry the
   same bytes (`esbuild-contract-source-pin.test.ts`) → I2, scenario 2
2. `vite build` on both starters completes with `typeof globalThis.__riftyTrackCliPromise
   === 'undefined'` in the config realm; `trackKeepalivePromise` is no longer a
   `@riftydev/runtime-js` export (`packages/runtime-js/src/index-surface.test.ts`) → I2, ADR-0530
3. `vite build` with a throwing `vite.config.js` prints `failed to load config
   from …/vite.config.js`, `error during build:`, `Error: <message>` and exits 1,
   as real Node → I2, ADR-0530
4. Existing Vite 7.3.6 build/dev/preview/optimize and Vite 8 build/preview
   lanes green without the hook: `esbuild-vite-contract`, `sass-vite-contract`,
   `vite-build-failure-containment`, `workbench-vite-lifecycle`,
   `message-port-ref-keepalive` (Vite 8 rolldown), e2e `vite7-build-preview`,
   `vite-command-honesty`, `vite-save-trust-rebind`, `vite-temp-trust-churn`,
   `instant-preset-reset`, no-COI `no-coi-sandbox-build-loop` except its
   module-count row → I2

Carrier: `tests/browser-unit/vite-cli-upstream-bytes.spec.ts` (rows 1-3),
`tests/integration/vite-cli-prep.test.ts`, `tools/checks/install-artifact-identity.test.ts`.

## Out of scope

- The root-watcher and root-URL policies (`viteRootWatchPatchPolicy`,
  `viteRootUrlPatchPolicy`) — classified by
  `npm-client/guest-package-adaptation-inventory-classes` on real-Node evidence.
- Vite 7.3.7 / proven-version admission policy — separate refine.

## Decisions

- re-cut: 2026-10-16 — Acceptance 4 carrier list drops three lanes red on
  `aebdd7ddd` before this unit, for causes outside the hook: `child-fs-in-realm-lane`
  and no-COI "build parity … designed RED" run `vite build` to completion
  (`✓ 2990 modules transformed`, exit 0) and fail only the frozen `2180` count
  over live transitive versions (draft `distribution/build-module-count-pins-over-live-transitives`);
  e2e `react-vite-build` never starts Vite (fresh install resolves 7.3.7, exact-7.3.6
  gate refuses — draft `npm-client/vite-7-3-7-from-scratch-esbuild-refusal`).
  I2's clause stays carried by the remaining 7.3.6/Vite 8 lanes — trace: none
- 2026-10-16 — Final+GREEN BLOCK @ 72bd575da (codex): F1 no carrier for the
  removed export — HOLDS, fixed (`index-surface.test.ts`); F2 three named
  lanes not green — reproduced on main, re-cut above with the evidence.

- 2026-10-16 — pickup: observed undeclared adaptation with an upstream-bytes
  baseline; RED on `aebdd7ddd`; ADR-0530 removes the policy and the public
  `trackKeepalivePromise` export (no consumer outside the hook, open question
  answered by grep over packages/apps/tools/tests). Snapshots re-baked over
  committed lockfile pins: a live re-resolve pulled Vite 7.3.7 and newer
  transitive versions (out of scope — goal map §Out of scope).

- 2026-10-15 — rejected: keep the hook as a declared "handle-mapping"
  adaptation — it maps no Node handle (CAC's un-awaited promise holds nothing
  in Node either); the loop is held by the action's real handles.
