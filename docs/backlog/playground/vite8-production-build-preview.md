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

With the lifecycle held open (proven by running `vite.build()` via the Node API so
the entry AWAITS it), the Rolldown WASI pool **starts real work and then crashes
non-deterministically** in a pthread worker:
- run A: `RuntimeError: operation does not support unaligned accesses`
- run B: `RuntimeError: memory access out of bounds`
both at `@emnapi/core` during bundling. These are V8 **WASM** memory traps.

Ruled out by experiment (each a single-variable test):
- **Not the CLI** — the Vite Node API (`await vite.build()`) hits the SAME crash.
- **Not message-delivery timing** — ongoing fork-IPC delivery is already immediate
  (`process.ts` emits on `onmessage`, no defer); delaying the initial `__emnapi__:load`
  backlog flush 0→200ms did not change the crash; `wasi-worker.mjs` self-bridges
  `parentPort.on('message') → globalThis.onmessage`, so parentPort delivery suffices.
- **Not multi-thread contention** — forcing `os.availableParallelism()=1` (one
  pthread) still crashes.
- **Not broken SAB sharing** — a direct probe (create a `SharedArrayBuffer`,
  `postMessage` it into a NESTED `worker_threads` worker, worker `Atomics.store(…,42)`,
  parent reads back `42`) confirms rifty shares SAB into nested workers correctly.

ROOT (most likely): **stale WASM memory views after `memory.grow()`** inside
`@napi-rs/wasm-runtime`/emnapi — when the main thread grows the shared memory, the
pthread's cached typed-array views are not refreshed, so it accesses out-of-bounds /
unaligned. This lives in the GUEST WASM-runtime (emnapi/@napi-rs/wasm-runtime/
Rolldown), not in rifty's IPC or memory sharing. Non-deterministic, even with a
single worker thread. Not fixable in rifty without patching guest-package internals
or upstream Rolldown/emnapi/napi-rs.

## Options or Next (the real fix)

1. **Upstream / guest-runtime**: engage Rolldown / `@napi-rs/wasm-runtime` / emnapi
   on the shared-memory-growth view-refresh in the browser WASM-threads pool, or
   pin a binding version whose bundle path is browser-clean. Re-verify with a
   `vite.build()` Node-API smoke before re-wiring the CLI.
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
