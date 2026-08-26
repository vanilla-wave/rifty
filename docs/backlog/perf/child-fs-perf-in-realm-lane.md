---
area: perf
subsystem: toolchain-build
status: ready
title: Child fs perf real single in-realm Worker lane
created: 2026-08-26
epic: child-fs-rpc-hot-path
why: the comparison anchor needs identical guest bytes executed with fs and loader in one real Worker, without SAB RPC or a child-side cache
user_story: As the child-fs measurement rig, I want both anchors executed in one real in-realm Worker, but today that topology exists only as throwaway spike code.
sources: [perf/child-fs-perf-lane split @ fb02b2c2f, spike 1261339acc1d1eb3f864a9a48ed50bf067fe0f02, ADR-0196]
code: [tests/browser-unit/fixtures/child-fs-in-realm-lane.ts, tests/browser-unit/fixtures/child-fs-in-realm-worker.ts, tests/browser-unit/child-fs-in-realm-lane.spec.ts, tests/browser-unit/child-fs-in-realm-lane.fault.spec.ts]
---

## User scenario

On the real browser-unit page, pass a recording host into
`runChildFsInRealmLane`. It creates one fresh module Worker for the sample. That
Worker owns one Memory VFS, installs the exact canonical npm tree from the real
registry route, activates the shipped Vite/esbuild adapters, then loader-runs
Vite and Express in that same realm. A strict single-flight command protocol
lets the page independently record every input/result and build the raw sample;
the Worker never self-attests a finished sample.

## Acceptance

- The runner opens exactly one real module Worker from the pinned fixture URL,
  accepts one ready, then sends exactly boot → seed → install → marker
  manifest reads → marker write → Vite → assets readdir/read → Express
  commands, one at a time. Every command accepts one exact-schema typed reply
  whose path echoes the request; error, malformed, duplicate or out-of-order
  messages reject and still terminate once.
- Inside that Worker, `installMemoryFs()` supplies the one shared async/sync
  store. The runner sends exact `childFsScenario()` files/dependencies; the
  Worker seeds them at `/bench`, uses real `RegistryClient` + `install`, then the
  runner separately reads every direct installed package version. The Worker
  activates the real shadow-asset esbuild runtime plus Vite acquisition/run
  preparation. No kernel Worker, sync-RPC FS, OPFS, or child cache participates.
- After install/preparation, the Worker writes exactly one run-specific Panel
  marker, loader-runs `/bench/node_modules/.bin/vite build`, reads every emitted
  JS asset, then loader-runs canonical `/bench/express-anchor.cjs <marker>` with
  real net/http builtins and waits through READY→CLOSED before reporting.
- The runner builds the raw result only from independently recorded Vite,
  emitted-read and Express replies. It has in-realm topology/ordinal/idle-owner
  identity, passes `validateChildFsRawSample`, and reports exactly 2180 Vite
  modules, one positive self-time, one emitted marker, and one positive matching
  Express READY before CLOSED.
- Worker setup/run failures are serialized with name/message/stack; page-side
  Worker `error`/`messageerror`, protocol corruption, and result validation are
  loud. The runner settles only after termination; it never converts a partial
  log/phase trace into a sample.

## Parity cases

- `in-realm-vite-2180`: exact canonical tree/install in one Memory-VFS Worker →
  exit 0, exactly 2180 modules, positive self-time, fresh emitted marker.
- `in-realm-express-cold`: later canonical loader run in the same Worker →
  exit 0, positive matching READY before CLOSED.
- `single-worker-topology`: caller records one module Worker, exact sequential
  command/reply trace, no second command in flight, and one final terminate; no
  page FS proxy or Worker-produced aggregate sample. Playwright's independent
  page Worker inventory contains that exact fixture URL and no nested Worker.

## Fault matrix

| Boundary / axis | Required outcome | RED target |
|---|---|---|
| Worker protocol `corrupt-input` / `lossy-aggregate` | reject reply-before-ready, wrong/duplicate reply type and invalid raw facts | recording host table + shared verifier |
| Worker lifecycle `provenance-lie` / failure | real failing Worker error rejects; terminate exactly once; no result | fault-labelled injected Worker URL |
| registry/runtime `provenance-lie` / failure | worker error envelope preserves the real failure; no sample | failed real registry route or runtime setup |

Orchestrator deadlines, cross-lane cancellation and artifact publication remain
with `perf/child-fs-perf-orchestrator`; this lane owns one sample lifecycle only.

## Out of scope

- Product owner/kernel/SAB path, OPFS persistence, cold-realm recycling, loaded
  owner stress, thresholds, and multi-sample scheduling.
- New package exports or production topology. Test-only wiring composes current
  real Memory VFS, npm client, loader, net and Workbench runtime adapters.
- Porting prototype probes, SDK lane, fs microbench or framing benchmark.

## Decisions

- 2026-08-26 — one fresh Worker performs install + both anchors, then terminates;
  no page-side execution and no nested Worker. One Worker is the comparison
  topology, not a reusable pool.
- 2026-08-26 — Memory VFS is the only store; npm async writes and loader sync
  reads share its paired backend. OPFS/cross-realm persistence machinery has no
  forcing constraint here and does not port from the prototype.
- 2026-08-26 — reuse shipped adapter/preparation modules from test-only wiring;
  do not widen public APIs for a benchmark.
- 2026-08-26 — strict single-flight typed messages, no request ids/correlation
  map: the lane has one Worker and one outstanding phase. Page runner, not
  Worker, owns aggregation and shared verification.
- 2026-08-26 — expected RED: both browser-unit specs import absent
  `fixtures/child-fs-in-realm-lane.ts` / Worker fixture.
- 2026-08-26 — Contract+RED @ b5cbba7e7 blocked: trace stopped at readdir,
  reply schemas/paths and `messageerror` were porous, error envelopes projected,
  URL/nested-Worker provenance weak, and ledger band absent. Re-cut in place.
- 2026-08-26 — Contract+RED @ c4e57fef9 blocked: corrupt late Vite/
  entries/asset/Express replies survived; real registry envelope provenance not
  inspected. Full phase schema sweep + real error reply retained.
- 2026-08-26 — Contract+RED @ 0c73c30b5 blocked: exact keys did not reject
  wrong backend/seeded/written/entries values. Structured-value sweep added.
- 2026-08-26 — Contract+RED @ 9079ed68b blocked: wrong-kind carrier also had
  wrong shape; only real success ordinal was 5. Same-shape discriminant fault +
  valid ordinal-3 controlled boundary added.
- 2026-08-26 — Contract+RED @ 1bf2ff23f blocked: terminal Express discriminant
  survived the boot/Vite examples. Same-shape wrong-kind sweep now covers every
  reply type.
- 2026-08-26 — Contract+RED @ 581e980fd blocked: one-shot readiness could
  ignore a duplicate before command dispatch. Duplicate-ready now rejects with
  zero posts and one terminate.
- 2026-08-26 — Contract+RED @ 6e39e3fe7 blocked: `messageerror` after ready
  could hang an in-flight command. Pre-ready and in-flight carriers now reject.
- 2026-08-26 — Contract+RED @ 00f768d02 blocked: a mixed valid + foreign
  entries set could be lossy-filtered. Every returned path must be an exact
  direct child before JS selection.
- 2026-08-26 — Contract+RED @ 730e19ff6 blocked: Worker `error` was real only
  before ready. Controlled pre-ready + in-flight `error` now mirror the
  `messageerror` lifecycle sweep.
- 2026-08-26 — Contract+RED @ 8084fe65c blocked: duplicate terminal Express
  could be ignored during resolve/terminate. Synchronous duplicate-Express now
  rejects before completion.
