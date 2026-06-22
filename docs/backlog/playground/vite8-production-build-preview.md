---
area: playground
status: active
title: vite8 — production build/preview (`vite build`/`vite preview`/`vite optimize`) over the Rolldown WASI path
created: 2026-06-21
why: The real-vite sandbox is dev-server-only. `vite build`/`preview`/`optimize` LOUD-reject (real-vite-bootstrap.ts). A full implementation attempt cleared a child-realm-lifecycle wall but then hit a DEEPER, upstream-class blocker — the Rolldown WASI production bundle itself crashes with non-deterministic WASM memory corruption in the emnapi pthread pool. Build/preview are NOT achievable in the browser today (neither via the real CLI nor via the Vite Node API).
user_story: As a dev in the playground, I want `vite build` to produce a `dist/` bundle and `vite preview` to serve it (like a fresh `npm create vite` project), but today the sandbox is dev-only.
sources: [apps/playground/src/workers/real-vite-bootstrap.ts, packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, apps/playground/src/workers/node-program-lifecycle.ts, docs/adr/runtime-js/0162-vite-8-rolldown-wasi-browser-boot-runtime-surface.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

`runDevServer` (Rolldown WASI over kernel-backed `worker_threads`) is the only
working Vite path. `vite build`/`preview`/`optimize` LOUD-reject in the `vite`
shell command (real-vite-bootstrap.ts). The dev server boots Rolldown's WASI
binding and *serves* (m7 green) but, with `optimizeDeps` off (`noDiscovery`),
**never runs an actual production bundle** — so the bundle path below was unproven
until this investigation.

## Two walls (the second is the blocker)

A full implementation was built (real `.bin/vite` via the bin lane + a seeded
`vite.config.js` + a render-guard e2e) and reverted to the honest loud-reject once
the second wall proved upstream-class. The investigation (evidence below) is the
deliverable.

### Wall 1 — child-realm async lifecycle (FIXABLE; partially landed)

Vite's cac CLI `cli.parse()` matches `build` synchronously and invokes an async
`.action()` that cac does NOT await — so `runNodeEntry`'s top-level resolves with
`build()` still detached/pending. The supervised child's keepalive refcount
(`event-loop-keepalive.ts`) saw no live handle and `awaitDrain` reaped the realm
(exit 0) before the build ran. ROOT: `worker_threads.Worker` did not participate
in the keepalive — a live kernel Worker must keep the realm's loop alive (Node
parity). Fixed by making the kernel-backed `Worker` ref/unref the keepalive
(ref on a live worker, unref on exit/terminate; `ref()`/`unref()` toggle) — **this
fidelity fix LANDED standalone** (`worker_threads.ts`). The preview lane also needs
the serve lifecycle to re-check `listPorts` after drain (detached `listen()`); that
half was reverted with the rest of the build/preview wiring.

### Wall 2 — Rolldown WASI production bundle crashes (UPSTREAM-class; the blocker)

With the lifecycle held open (proven by driving `viteNs.build()` / `rolldown.build()`
inside the dev-server child realm, which already has the Rolldown WASI plumbing), the
Rolldown WASI pool **starts real work and crashes NON-DETERMINISTICALLY** in a pthread
worker — three distinct V8 **WASM** memory traps, all at `@emnapi/core` during bundling:
`operation does not support unaligned accesses`, `memory access out of bounds`,
`unreachable`.

**It is a RACE, not always-broken, and the crash rate scales with bundling WORK**
(measured, instant vite preset, dev-child realm):
- trivial `rolldown.build()` (1-file input): ~1/6 crash (mostly OK).
- real `viteNs.build()` (seed project + Vite pipeline): ~3/4 crash (1/4 OK).
- real `viteNs.build()` with `os.availableParallelism()=1` (one pthread): ~4/5 crash.

So a real project's build is effectively unusable (mostly crashes), and **a retry/lower-
parallelism mitigation does NOT work** (single-thread is no better — it is a main↔worker
shared-memory race present even with one worker, not multi-thread contention).

Ruled out by experiment (single-variable):
- **Not the CLI** — the Vite Node API (`await vite.build()`) hits the SAME crash.
- **Not message-delivery timing** — ongoing fork-IPC delivery is already immediate
  (`process.ts` emits on `onmessage`, no defer); delaying the initial `__emnapi__:load`
  backlog flush 0→200ms did not change it; `wasi-worker.mjs` self-bridges
  `parentPort.on('message') → globalThis.onmessage`, so parentPort delivery suffices.
- **Not multi-thread contention** — `os.availableParallelism()=1` still crashes (~80%).
- **Not broken SAB sharing** — a direct probe (`SharedArrayBuffer` `postMessage`'d into a
  NESTED `worker_threads` worker, worker `Atomics.store(…,42)`, parent reads `42`)
  confirms rifty shares SAB into nested workers correctly.
- **Not a stale guest runtime** — the snapshot ALREADY pins the latest runtime:
  `@napi-rs/wasm-runtime@1.1.4` + `@emnapi/core`/`@emnapi/runtime@1.10.0` (binding 1.0.3
  and binding 1.1.0 both depend on these exact versions). So no runtime-version bump is
  available. The only newer Rolldown **.wasm** is `@rolldown/binding-wasm32-wasi@1.1.0`
  (= `rolldown@1.1.0`, ABI-coupled), but **no released Vite uses it** — `vite@latest`
  (8.0.16) pins `rolldown@1.0.3`. Testing 1.1.0 directly needs a from-scratch install
  (untried here) and is not adoptable until Vite ships a rolldown ≥1.1.0.

ROOT (most likely): **stale WASM memory views after `memory.grow()`** inside the
Rolldown WASI / emnapi pool — the main thread grows the shared memory and a worker's
cached typed-array views are not refreshed before it reads, so it hits out-of-bounds /
unaligned / unreachable. This lives in the GUEST WASM-runtime (Rolldown `.wasm` +
emnapi/@napi-rs/wasm-runtime), not in rifty's IPC or memory sharing. A race; more work
= higher hit rate. Not fixable in rifty without patching guest-package internals or an
upstream Rolldown/emnapi/napi-rs fix.

## Options or Next (the real fix)

1. **Upstream / guest-runtime** (the race lives there): engage Rolldown /
   `@napi-rs/wasm-runtime` / emnapi on the shared-memory-growth view-refresh in the
   browser WASM-threads pool. A runtime bump is NOT available (already latest); the
   only lever is a newer Rolldown `.wasm` — re-test once Vite ships a `rolldown ≥1.1.0`
   (or smoke `rolldown@1.1.0` directly via a from-scratch install). Re-verify with a
   repeated `viteNs.build()` smoke (it is a RACE — one green run is not proof; need a
   high pass rate across N runs) before re-wiring the CLI.
2. **Then** re-wire the router (real `.bin/vite` via `createOwnerChildBinExecutor`
   for build/optimize; `createOwnerChildNodeExecutor(…, /*bin*/ true)` for preview)
   + re-thread the Phase-1 bin-lane Rolldown enabler (worker URLs + fs-relay in
   `node-entry-bootstrap`) + the preview `listPorts`-after-drain re-check + the
   seeded `vite.config.js` (`base:'./'` + pinned preview port), and add the
   render-guard e2e proving the BUILT `#app` text renders through `/preview/4173/`.

The interim loud-reject is the honest gap (Fidelity — never a silent exit-0-no-dist).

## Reversibility

REVERSIBLE — additive command path over the existing infra; no public-API/ADR
contradiction. Wall 2 is the hard blocker and is upstream-class.
