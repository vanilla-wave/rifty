---
area: npm-client
status: draft
title: The installed Vite `dist/node/cli.js` carries no rifty keepalive patch — the CAC action hook (`__riftyTrackCliPromise`) is removed once the Vite lanes prove it is not load-bearing
created: 2026-10-15
why: the hook pins Vite's whole un-awaited CAC action promise as one keepalive ref; it predates the generated esbuild client's own handle mapping (`runtime-service-refs` = upstream `child.ref()/unref()`), and a two-arm probe shows `vite build` completes identically with the hook inert — an adaptation with no named platform gap behind it is undeclared debt
user_story: As a developer running `vite build` on the Vite 7 starter, I want the installed `cli.js` to be the upstream 7.3.6 bytes and the build to exit when its real work is done, but today rifty rewrites `this.runMatchedCommand();` and re-validates that rewrite before every CLI start
epic: honest-guest-package-adaptations
blocked_by: []
sources: [ADR-0174, ADR-0226, ADR-0384, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md]
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

<!-- finding capture — no premise critic at draft (README §Challenge) -->

## Out of scope

- The root-watcher and root-URL policies (`viteRootWatchPatchPolicy`,
  `viteRootUrlPatchPolicy`) — classified by
  `npm-client/guest-package-adaptation-inventory-classes` on real-Node evidence.
- Vite 7.3.7 / proven-version admission policy — separate refine; COI answered by `epics/esbuild-upstream-twin` I6 (exact-7.3.6 gate removed, other Vite "⚠️ not verified", user 2026-10-16), no-COI unchanged.

## Decisions

- 2026-10-15 — rejected: keep the hook as a declared "handle-mapping"
  adaptation — it maps no Node handle (CAC's un-awaited promise holds nothing
  in Node either); the loop is held by the action's real handles.
