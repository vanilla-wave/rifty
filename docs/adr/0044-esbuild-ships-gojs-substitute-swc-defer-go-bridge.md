# ADR 0044: esbuild ships gojs ABI — substitute swc as the M8/M10 forcing consumer; defer the Go-runtime bridge

Status: Accepted
Date: 2026-05-27

## Context

M8's open-acceptance row called for vendoring `esbuild.wasm` end-to-end
through `@rifty/runtime-wasi`, and M10 named `Vite ↔ esbuild.wasm` as
the shadow-binding target. Q-2026-05-27-003 (preopens/cwd API) was
explicitly waiting for esbuild's behaviour as its forcing consumer. The
plan assumed esbuild shipped a `wasi_snapshot_preview1` build to npm.

A Wave-2 vendoring spike (2026-05-27) inspected all three published
candidates — `esbuild-wasm@0.21.5`, `0.25.0`, and `0.28.0`. Every one of
them imports the **`gojs` ABI** (Go's `js/wasm` target):
`gojs.runtime.*`, `gojs.syscall/js.*`, and friends. None of them imports
`wasi_snapshot_preview1`. esbuild is written in Go and only publishes
the `js/wasm` target — there is no upstream WASI build, and the path
from Go source to a real WASI binary is non-trivial (Go's WASI/WASIp1
support exists but the esbuild project does not ship it).

`@rifty/runtime-wasi` is a WASI preview1 shim; it cannot host a `gojs`
guest. The Go-runtime ABI is a different host contract: a `syscall/js`
handle protocol, a `wasm_exec.js`-equivalent host shim, GC interop, and
goroutine scheduling. Implementing it is a multi-week design effort on
its own.

This is **IRREVERSIBLE per the Reversibility checklist** (M8/M10
acceptance criteria and Q-2026-05-27-003's forcing consumer all
referenced esbuild explicitly), so an ADR is required.

## Decision

### D1: swc replaces esbuild as the M8/M10 forcing consumer

`swc` (Rust → wasm) publishes a real WASI build to npm and exercises the
same surface area we need from M8's runner — argv, environ, fd_read /
fd_write, preopens, proc_exit, plus enough fs syscalls to read a TS file
and write the JS output. The exact published package name will be
verified at vendoring time (swc's published WASI build — exact package
TBD when vendored); the design point is "a Rust-source, WASIp1-target
binary that performs TS/JSX transformation," and swc satisfies it
upstream.

### D2: Q-2026-05-27-003 (preopens/cwd API) keeps the same options, new
forcing consumer

The three options (A: `cwd?: string`, B: ordered array, C: both) are
unchanged. The decision is still deferred until the real consumer runs
through `runWasi` and exposes the constraints. The consumer is now
`swc.wasm` rather than `esbuild.wasm`; the question stays Active.

### D3: Go-runtime (gojs) bridge is deferred — no work now

`@rifty/runtime-go-wasm` (or whatever name lands) is not in M8, M10, or
M11. The required scope is:

- Full `syscall/js` handle protocol (Go's bidirectional JS↔Go value
  references — a host-side handle table, ref/unref semantics, function
  call marshalling).
- `wasm_exec.js`-equivalent host shim (the runtime glue Go ships in its
  `misc/wasm/` directory — argv/env, time, random, fs stub).
- Per-instance GC + goroutine scheduling integration with our process
  model.

That is multi-week work whose only currently-named beneficiary is
esbuild. It blocks no other milestone. The task is parked in TASKS.md
under the Follow-ups section so it is not lost.

### D4: This is a docs-only correction; no code changes ship in this ADR

The runtime-wasi shim, the M8 conformance tests, and the
`tests/integration/` set are all unchanged by this ADR. The next code
change in this lane is the swc vendoring PR, which closes the M8
open-acceptance row and pins down Q-2026-05-27-003.

## Alternatives considered

- **Build `@rifty/runtime-go-wasm` now.** Rejected as multi-week design
  (full `syscall/js` handle protocol, GC interop, `wasm_exec.js`
  rebuild). The only currently-named beneficiary is esbuild, and we
  have a substitute that ships WASI today (swc). Pay this cost when a
  second Go-WASM guest appears, not for one.
- **Drop esbuild entirely from the long-term plan.** Rejected: M10 still
  wants a TS/JSX transform on the dev path, and the architectural
  question — "does our WASI runner host a real-world transformer?" —
  has not gone away. swc covers the same architectural need with a
  binary we can actually run today.
- **Stay with esbuild as the goal; accept M8 stays open indefinitely.**
  Rejected: M10's `Vite ↔ <transformer>.wasm` shadow-binding has to
  point somewhere concrete, and an indefinitely-open M8 row blocks the
  M10 close.

## Trade-offs

- **swc ≠ esbuild bundle-for-bundle.** Vite's downstream shadow-binding
  will target the swc API surface instead of esbuild's. The
  shadow-registry adapter (ADR-0015) handles the API rename; the wire
  contract through `@rifty/runtime-wasi` is unchanged.
- **The Go bridge is not gone — it's parked.** A future task can pick
  up the gojs work without re-litigating this ADR; the only thing this
  ADR commits to is that the bridge is not part of M8/M10/M11.
- **Q-2026-05-27-003's design budget shifts to swc's constraints.**
  Whatever working-directory and preopen semantics swc needs will pin
  down the API. esbuild's behaviour is now informational only (it would
  re-enter the picture if and only if the Go bridge ever lands).

## Consequences

- `PROJECT_PLAN.md` edits: L13, L29, L173, L326, L327, L333, L366
  rewritten to name swc where they used to name esbuild, with a
  cross-reference to this ADR the first time esbuild is removed from
  the WASI lineup so the historical trail is visible.
- `TASKS.md` edits: M8 open-acceptance row and M10 open-acceptance row
  point at swc; a new Follow-ups entry parks the Go-runtime bridge
  work.
- `OPEN_QUESTIONS.md` Q-2026-05-27-003 gets an amendment noting the
  forcing-consumer change; status stays Active; the "Needs human review
  by" target re-points at *Start of M8 swc.wasm vendoring work (per
  ADR-0044)*.
- `CHANGELOG.md` Unreleased Documented entry records the planning
  correction.
- No source code changes ship in this PR.

## References

- `PROJECT_PLAN.md` §4 milestones M8 and M10.
- `OPEN_QUESTIONS.md` Q-2026-05-27-003 (preopens/cwd API).
- ADR-0015 (shadow-registry consolidation — the layer where the
  Vite↔swc API translation lives).
- ADR-0011 (sync IPC + worker-as-process — the runtime that hosts the
  swc.wasm guest, unchanged by this ADR).
