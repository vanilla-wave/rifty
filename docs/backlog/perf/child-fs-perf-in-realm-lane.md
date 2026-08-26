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
Vite and Express in that same realm. The page independently records the Worker
URL/messages/termination; the returned raw sample passes the shared verifier.

## Acceptance

- The runner opens exactly one real module Worker from the pinned fixture URL,
  sends one `{ordinal, registryUrl:'/npm-registry'}` start, accepts one ready and
  one result for that ordinal, then terminates once. Error, malformed, duplicate
  or out-of-order messages reject without a sample and still terminate once.
- Inside that Worker, `installMemoryFs()` supplies the one shared async/sync
  store. It seeds the exact `childFsScenario()` files at `/bench`, uses real
  `RegistryClient` + `install`, reads every direct installed package version,
  and activates the real shadow-asset esbuild runtime plus Vite acquisition/run
  preparation. No kernel Worker, sync-RPC FS, OPFS, or child cache participates.
- After install/preparation, the Worker writes exactly one run-specific Panel
  marker, loader-runs `/bench/node_modules/.bin/vite build`, reads every emitted
  JS asset, then loader-runs canonical `/bench/express-anchor.cjs <marker>` with
  real net/http builtins and waits through READY→CLOSED before reporting.
- The raw result has in-realm topology/ordinal/idle-owner identity, equals the
  independently recorded result message, passes `validateChildFsRawSample`, and
  reports exactly 2180 Vite modules, one positive self-time, one emitted marker,
  and one positive matching Express READY before CLOSED.
- Worker setup/run failures are serialized with name/message/stack; page-side
  Worker `error`/`messageerror`, protocol corruption, and result validation are
  loud. The runner settles only after termination; it never converts a partial
  log/phase trace into a sample.

## Parity cases

- `in-realm-vite-2180`: exact canonical tree/install in one Memory-VFS Worker →
  exit 0, exactly 2180 modules, positive self-time, fresh emitted marker.
- `in-realm-express-cold`: later canonical loader run in the same Worker →
  exit 0, positive matching READY before CLOSED.
- `single-worker-topology`: caller records one module Worker, ordered ready/result
  messages, exact ordinal/sample, and one final terminate; no page FS proxy.

## Fault matrix

| Boundary / axis | Required outcome | RED target |
|---|---|---|
| Worker protocol `corrupt-input` / `lossy-aggregate` | reject wrong ordinal/type, result before ready, duplicate result, invalid raw sample | recording host table + shared verifier |
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
- 2026-08-26 — expected RED: both browser-unit specs import absent
  `fixtures/child-fs-in-realm-lane.ts` / Worker fixture.
