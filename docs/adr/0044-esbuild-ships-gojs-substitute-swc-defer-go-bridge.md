# ADR 0044: esbuild ships gojs ABI — substitute swc as the M8/M10 forcing consumer; defer the Go-runtime bridge

Status: Accepted
Date: 2026-05-27

## Context

M8's open-acceptance row called for vendoring `esbuild.wasm` end-to-end through `@riftydev/runtime-wasi`; M10 named `Vite ↔ esbuild.wasm` as the shadow-binding target; Q-2026-05-27-003 (preopens/cwd API) waited on esbuild as its forcing consumer. All assumed esbuild ships a `wasi_snapshot_preview1` build to npm.

A Wave-2 vendoring spike (2026-05-27) checked `esbuild-wasm@0.21.5`, `0.25.0`, `0.28.0`. Every one imports the **`gojs` ABI** (Go's `js/wasm` target: `gojs.runtime.*`, `gojs.syscall/js.*`); none imports `wasi_snapshot_preview1`. esbuild is Go and ships only `js/wasm` — no upstream WASI build, and the Go-source → WASI path is non-trivial (Go's WASIp1 exists, esbuild doesn't ship it).

`@riftydev/runtime-wasi` is a WASI preview1 shim and cannot host a `gojs` guest. The gojs ABI is a different host contract (`syscall/js` handle protocol, `wasm_exec.js`-equivalent shim, GC interop, goroutine scheduling) — a multi-week effort.

**IRREVERSIBLE per the Reversibility checklist** (M8/M10 acceptance and Q-2026-05-27-003's forcing consumer all named esbuild), so an ADR is required.

## Decision

**D1: swc replaces esbuild as the M8/M10 forcing consumer.** `swc` (Rust → wasm) ships a real WASI build to npm and exercises the M8 surface we need: argv, environ, fd_read/fd_write, preopens, proc_exit, plus enough fs syscalls to read a TS file and write JS. Exact package name TBD at vendoring time; design point is "Rust-source, WASIp1-target binary doing TS/JSX transform," which swc satisfies upstream.

**D2: Q-2026-05-27-003 (preopens/cwd API) — same options, new forcing consumer.** Options unchanged (A: `cwd?: string`; B: ordered array; C: both). Still deferred until the real consumer runs through `runWasi` and exposes constraints. Consumer is now `swc.wasm`, not `esbuild.wasm`; question stays Active.

**D3: Go-runtime (gojs) bridge deferred — no work now.** `@riftydev/runtime-go-wasm` is not in M8, M10, or M11. Required scope:
- Full `syscall/js` handle protocol (bidirectional JS↔Go value refs — host-side handle table, ref/unref, function-call marshalling).
- `wasm_exec.js`-equivalent host shim (Go's `misc/wasm/` glue — argv/env, time, random, fs stub).
- Per-instance GC + goroutine scheduling integrated with our process model.

Multi-week work whose only named beneficiary is esbuild; blocks no milestone. Parked in TASKS.md Follow-ups.

**D4: Docs-only correction; no code ships in this ADR.** runtime-wasi shim, M8 conformance tests, and `tests/integration/` all unchanged. Next code change in this lane is the swc vendoring PR, which closes the M8 open-acceptance row and pins Q-2026-05-27-003.

## Alternatives considered

- **Build `@riftydev/runtime-go-wasm` now.** Rejected — multi-week design (full `syscall/js` protocol, GC interop, `wasm_exec.js` rebuild) for one named beneficiary (esbuild), when swc ships WASI today. Pay this cost when a second Go-WASM guest appears.
- **Drop esbuild from the long-term plan entirely.** Rejected — M10 still needs a TS/JSX transform on the dev path, and "does our WASI runner host a real-world transformer?" remains open. swc covers the same need with a runnable binary.
- **Keep esbuild as the goal; accept M8 stays open indefinitely.** Rejected — M10's `Vite ↔ <transformer>.wasm` shadow-binding must point somewhere concrete; an open-indefinitely M8 row blocks the M10 close.

## Trade-offs

- **swc ≠ esbuild bundle-for-bundle.** Vite's shadow-binding targets the swc API surface, not esbuild's. The shadow-registry adapter (ADR-0015) handles the API rename; the wire contract through `@riftydev/runtime-wasi` is unchanged.
- **Go bridge parked, not gone.** A future task picks up gojs without re-litigating this ADR; the only commitment here is "not part of M8/M10/M11."
- **Q-2026-05-27-003's design budget shifts to swc's constraints.** swc's working-directory/preopen needs pin the API. esbuild's behaviour is now informational only (relevant again only if the Go bridge ever lands).

## Consequences

- `PROJECT_PLAN.md`: L13, L29, L173, L326, L327, L333, L366 rewritten to name swc instead of esbuild, with a cross-ref to this ADR at the first esbuild removal so the historical trail stays visible.
- `TASKS.md`: M8 and M10 open-acceptance rows point at swc; new Follow-ups entry parks the Go-runtime bridge.
- `OPEN_QUESTIONS.md`: Q-2026-05-27-003 amended for the forcing-consumer change; status stays Active; "Needs human review by" re-points at *Start of M8 swc.wasm vendoring work (per ADR-0044)*.
- `CHANGELOG.md`: Unreleased Documented entry records the planning correction.
- No source code changes ship in this PR.

## References

- `PROJECT_PLAN.md` §4 milestones M8 and M10.
- `OPEN_QUESTIONS.md` Q-2026-05-27-003 (preopens/cwd API).
- ADR-0015 (shadow-registry consolidation — where the Vite↔swc API translation lives).
- ADR-0011 (sync IPC + worker-as-process — the runtime hosting the swc.wasm guest, unchanged by this ADR).
