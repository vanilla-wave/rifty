# ADR 0558: Export the isolate guest bundle and bridge contract as an unstable package

Status: Accepted
Date: 2026-11

> TL;DR: New zero-dependency package `@riftydev/isolate-guest` exports rifty's V8-isolate guest bundle (`./guest.js`), the bridge contract and a validating host bridge for custom embedders, unstable. `@riftydev/isolate-host` builds on it and ships the same bundle file.

## Context

Goal `isolate-guest-embed` (closed 2026-11-18, PR #411). User (2026-11-18, via the manager): «сразу сделаем
экспорт чистого rifty для кастомных интегарций. Ничего страшного, что контракт
будет меняться». A consumer embeds rifty in its own isolate (own isolated-vm,
own topology) without ADR-0557's host. Before this ADR the bundle and the bridge
were internal to `@riftydev/isolate-host`, whose install pulls
`isolated-vm@7.0.2`.

## Decision

1. Package `@riftydev/isolate-guest`, no dependencies of any kind (a subpath of
   isolate-host would install isolated-vm). Root exports:
   `createHostBridge(hooks) → { functions, timeOrigin, close }`, `exitStatus(value)`,
   `IMPORT_GAP`, `UNCOPYABLE_REJECTION`, and types `GuestHost`, `GuestEntry`,
   `HostFunctions`, `HostHooks`, `HostBridge`. The bundle is an asset subpath
   `./guest.js` (no .d.ts), resolved by the consumer
   (`import.meta.resolve`).
2. Contract (README §Contract, `src/contract.ts`): the embedder sets
   `globalThis.__riftyIsolateHost` = `{write, timerStart, timerClear, now,
   random, timeOrigin}` before the bundle runs (the bundle captures and deletes
   it); the bundle defines `globalThis.__riftyGuest` = `{run, fire,
   rejection}`, which the embedder takes and deletes before `run(code)`. The
   bundle runs as the classic script `rifty-isolate-guest.js`. The call ends at
   `run`'s status (`exitStatus`: an integer 0..255, else 1), a guest
   `import()` (the embedder writes `Error: ${IMPORT_GAP}`, exit 1, drops
   later output), or the embedder's own limit. Unhandled rejections go to
   `rejection` (a copy, or `UNCOPYABLE_REJECTION`).
3. `createHostBridge` is the one argument validation (ADR-0557 §6 rules,
   moved from `src/child/bridge.ts`): every guest argument range-checked,
   refusals are guest-safe `TypeError`s, a throwing hook is a refusal, a
   throwing `fire` hook ends its timer, `close()` clears every timer and
   makes `timerStart` a no-op. Embedder-neutral: no isolated-vm import; the
   embedder wraps `functions` in its own callback type. No isolated-vm
   adapter is exported; the README example shows the wiring.
4. One implementation: isolate-host's child uses `createHostBridge`,
   `exitStatus` and both constants from the export; its build copies the
   resolved `@riftydev/isolate-guest/guest.js` byte for byte into its own
   `dist/guest.js`, so the host tarball installs alone and `runCode`'s install
   and API are unchanged (its guest clock origin moved: Decisions 2026-11-18). The export is a devDependency of the host.
5. Unstable: `0.x`; any release may change the contract, with a CHANGELOG
   line. Bundle and host functions must come from one version; nothing checks
   a mismatch (no version handshake — the contract does not need one).
6. Proven on isolated-vm 7.0.2 / Node 24 (the README example over the
   isolate-host parity corpus). isolated-vm 6.2.0 has neither
   `onUnhandledRejection` nor `importModuleDynamically` (probe below): an unhandled rejection rejects the embedder's call instead of
   failing the run, `import()` rejects `Not supported` in the guest and a
   `.catch` keeps the run alive — a declared ceiling, compat ⚠️. Other
   embedders: untested.
7. Guest-visible texts keep their `isolate-host` names (`isolate-host bridge:`,
   `isolate-host.dynamic-import`): they are `runCode` output.

Not guaranteed to an embedder: ADR-0557's limits, kill, process boundary and
isolate-escape posture; with its own embedder they are its duty (README §What
you own).

Probe (2026-11-18, Node v24.16.0): `new ivm.Isolate({memoryLimit: 32,
onUnhandledRejection, importModuleDynamically})`; `ctx.evalClosure('globalThis.h
= { a: $0 }; h.a(new Uint8Array([1,2]))', [new ivm.Callback(log)])`;
`ctx.eval('Promise.reject(new Error("x")); import("x").then(()=>{}, (e) =>
h.a("import rejected: " + e.message))')`. 7.0.2: `cb got Uint8Array(2) [ 1, 2 ]`
/ `HOOK import` / `HOOK onUnhandledRejection x` / `cb got import rejected: no`.
6.2.0: `cb got Uint8Array(2) [ 1, 2 ]` / `cb got import rejected: Not supported`
/ the embedder's `eval` rejects `Error: x` — neither hook fires.

## Not the user's words

Manager's interpretation, unconfirmed by the user: «экспорт чистого rifty» =
the bundle plus the bridge contract; «контракт будет меняться» = unstable.
Manager decision 2026-11-18: isolated-vm 6.2.0 stays a declared ceiling.

## Consequences

- Custom embedders get rifty's `node -e` runtime without isolated-vm in the
  install; they own every limit and the boundary.
- Two packages to build in order (guest, then host); the isolate-host vitest
  lane builds both.
- Every contract change is a release note for embedders; stabilizing it is a
  later decision.

## Decisions

- 2026-11-18 — cross-review round 1: the guest clock starts at `createHostBridge` (`timeOrigin` returned by it, `now()` relative), not the embedder's process start — an in-process embedder leaked its uptime and linked calls; `runCode`'s guest clock now starts at the child's bridge setup. `guard` passes only refusals it created (by identity). The README example refuses isolated-vm < 7 and states it has no limits; the timer `fire` queue is unbounded embedder memory (compat ⚠️, backpressure owned by `backlog/distribution/isolate-host-timer-fire-backpressure`, due with the pool goal). The `isolate-host bridge:` prefix stays (one name with the other guest-visible `isolate-host.*` texts).
- 2026-11-18 — CLOSE review: the README example's write hook keeps `ended ||` — without it guest output after the `import()` gap leaked into the result nondeterministically (34/40 runs); carriers pin the post-gap forms. Landing verdict: `docs/backlog/distribution/reference/isolate-guest-embed-final-green.json` (PASS @ a1bcea70a, goal complete).
- 2026-11-18 — not the user's words (manager, cross-review round 1): `runCode`'s guest clock origin moved to the child's bridge setup — an observable `runCode` change outside the goal's "no change" line, declared in the isolate-host CHANGELOG; closer to `node -e`.
- 2026-11-19 — §3, goal `isolate-host-worker-pool` (manager scope): the `fire` hook returns a promise that settles once the guest ran the callback; a repeating timer re-arms only then, and keeps Node's period from the tick's start (`max(1, start + ms − now)`; Node's `listOnTimeout` re-inserts from the start, an overrun ticks again at once); a rejection ends the timer. Expiries no longer pile up in the embedder (20000 × `setInterval(f, 1)` had reached 4.96 GB; a 10 ms callback at 1 ms delayed a 1000 ms timeout to 8.8 s) — in a shared worker that queue was a neighbour's memory and latency. A hook returning no promise re-arms at once, unbounded (README). Closes `backlog/distribution/isolate-host-timer-fire-backpressure`; parity rows `slow-interval-keeps-pace`, `interval-keeps-its-period`, `interval-storm`.
- 2026-11-19 — goal `isolate-host-worker-pool`, cross-review rounds 1–2: each timer has its own slot, so a stale delivery of a reused id touches nothing of the new timer; a re-arm delay is whole ms rounded up (a fractional one fired early: 9.3 ms for a 10 ms interval).

- 2026-11-19 — §2: the pre-load GuestHost accepts allowSharedArrayBuffer (ADR-0566).
- 2026-11-22 — §1, §2: `GuestEntry` gains `snapshot(options)` and `restore(bytes, options)` (before `run` only); root exports `snapshotFs`, `restoreFs`, `FsSnapshotError` and their types; the guest FS is installed at bundle load (ADR-0567).
