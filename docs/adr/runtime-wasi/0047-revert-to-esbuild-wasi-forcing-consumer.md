# ADR 0047: Revert to esbuild (`@esbuild/wasi-preview1`) as the M8/M10 WASI forcing consumer — supersedes ADR-0044 D1/D2

Status: Accepted
Date: 2026-05-27

> TL;DR: M8/M10 WASI forcing consumer reverts to esbuild via real `@esbuild/wasi-preview1@0.28.0` (build-time vendored wasm, not a dep); swc dropped (no WASI build)

## Context

ADR-0044 (Accepted, 2026-05-27) substituted **swc** for **esbuild** as the M8 vendoring target and the M10 `Vite ↔ <transformer>.wasm` shadow-binding target, on two premises:

- **D1:** "swc publishes a real WASI build to npm" (package name "TBD when vendored" — explicitly hedged).
- Implicit: "esbuild has no upstream WASI build; every published `esbuild-wasm` (0.21.5 / 0.25.0 / 0.28.0) imports Go's `js/wasm` (`gojs`) ABI."

Both were **verified false** at vendoring time (the moment ADR-0044 D1 deferred verification to): swc verification failed, esbuild succeeded.

### Verified facts (2026-05-27 vendoring spike)

1. **swc has no WASI build.** `@swc/core-wasm32-wasi` → npm 404. `@swc/wasm`, `@swc/wasm-typescript`, `@swc/wasm-typescript-esm` are all **wasm-bindgen** modules (import `__wbindgen_*`, not `wasi_snapshot_preview1`). `@riftydev/runtime-wasi` is a WASI-preview1 shim and structurally cannot host a wasm-bindgen guest (needs JS glue + handle table, not a syscall ABI). swc-via-WASI is impossible today.

2. **esbuild HAS a real WASI build: `@esbuild/wasi-preview1@0.28.0`.** npm description: *"The WASI (WebAssembly System Interface) preview 1 binary for esbuild, a JavaScript bundler."* Tarball is `package.json` + `README.md` + a ~20 MB `esbuild.wasm`; **zero runtime deps**. Import section imports **only** `wasi_snapshot_preview1` (31 imports: `args_*`, `environ_*`, `fd_*`, `path_*`, `clock_time_get`, `random_get`, `poll_oneoff`, `sched_yield`, `sock_*`, `proc_exit`) — **no** `gojs.*`, `__wbindgen_*`, or bare `env`/`go`. Exports `_start` + `memory`. Runs end-to-end on `runWasi` (`esbuild --version` → exit 0, stdout `0.28.0`). This is a **different package** from `esbuild-wasm` (the gojs build, the only one ADR-0044's audit inspected — hence its wrong "no WASI build" conclusion).

Owner has ratified reversing to esbuild on these facts.

**IRREVERSIBLE per the Reversibility checklist** (re-points M8/M10 acceptance criteria + a forcing consumer ADR-0044 had moved), so a new ADR is required. Per "ADRs are immutable after merge," this supersedes the relevant parts of ADR-0044 rather than editing it.

## Decision

### D1: esbuild (`@esbuild/wasi-preview1`) restored as the M8/M10 forcing consumer — supersedes ADR-0044 D1

M8 vendoring target and M10 Vite shadow-binding target are esbuild again, vendored from `@esbuild/wasi-preview1@0.28.0`. swc is dropped — it has no WASI build to vendor, so ADR-0044 D1's premise fails. ADR-0044's stated need ("does our WASI runner host a real-world TS/JSX transformer?") is met by esbuild, the transformer Vite actually uses.

### D2: Q-2026-05-27-003's forcing consumer reverts to esbuild — supersedes ADR-0044 D2

ADR-0044 D2 re-pointed Q-2026-05-27-003 (WASI preopens/`cwd` API) at swc while keeping options A/B/C. Forcing consumer reverts to esbuild. Running esbuild through `runWasi` forced the decision (it opens its cwd dir and issues `AT_FDCWD`-relative path calls), so the question is **resolved** and promoted to **ADR-0049** (Option A — `cwd?: string`).

### D3: ADR-0044 D3 (Go-runtime / gojs bridge stays deferred) remains valid — now moot for esbuild

ADR-0044 D3 parked `@riftydev/runtime-go-wasm` (`syscall/js` handle protocol, `wasm_exec.js`-equivalent host shim, GC/goroutine integration) as multi-week work blocking nothing. **That stands.** Now **moot for esbuild specifically**: esbuild runs through the existing WASI-preview1 shim via `@esbuild/wasi-preview1` (a real WASI binary, *not* the gojs `esbuild-wasm`). The bridge is only ever needed for some *other* future gojs guest. The TASKS.md Follow-ups entry is retained, but its stated beneficiary ("esbuild") is struck.

### D4: ADR-0044 D4 (the swc switch was docs-only) unaffected; this ADR ships code

ADR-0044 D4 noted the swc switch shipped no code. This reversal *does* ship code: the esbuild.wasm vendoring script + artifact, the shadow-binding adapter, the runtime-wasi changes ADR-0049 covers, and integration + conformance tests. D4 described ADR-0044's own scope; not contradicted.

## Alternatives considered

- **Keep swc, find its WASI build later.** Rejected: no swc WASI build exists; published swc wasm is all wasm-bindgen, which our preview1 shim cannot host. Waiting leaves M8 open with no close path.
- **Build `@riftydev/runtime-go-wasm` to run the gojs `esbuild-wasm`.** Rejected as ADR-0044 D3 did (multi-week), and now unnecessary: `@esbuild/wasi-preview1` runs on the shim we already have.
- **Vendor esbuild as a runtime npm dependency.** Rejected per CLAUDE.md anti-pattern (build-time scripts over runtime deps). The wasm is pulled by a build-time fetch script, pinned by version + integrity, checked in as an artifact — not in any package's `dependencies`.

## Trade-offs

- **A 19.2 MB binary is checked in.** Accepted: price of an offline, reproducible, build-time-vendored toolchain. Pinned by SHA-512 integrity in the fetch script; marked `binary` in `.gitattributes`.
- **Shadow-binding targets esbuild's CLI transform surface, not its JS API.** Vite's `transform()` (TS/JSX → JS) maps onto `esbuild --loader=ts` over stdin. Dep-prebundle bundling (esbuild's `build()`) is not wired — a future need must run through `runWasi` too or throw `NotImplementedError('shadow-registry.esbuild.<feature>')` (no fake output).

## Consequences

- New build-time script `tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs` vendors `esbuild.wasm` to `tools/shadow-registry/vendor/esbuild-wasi-preview1/`.
- New shadow-binding `tools/shadow-registry/src/esbuild-binding.ts` (`transformWithEsbuild`, `loadVendoredEsbuildWasm`, `ESBUILD_WASM_VENDOR_PATH`) wires Vite's transform surface to `runWasi(esbuild.wasm, …)` via DI (no import edge from the tool to `@riftydev/runtime-wasi`).
- `@riftydev/runtime-wasi` gains `WasiOptions.cwd`, `AT_FDCWD` resolution, directory-open support in `path_open`, `E_NOTDIR` from `fd_readdir` on a file fd, and a wired stdin reader — all covered by ADR-0049.
- Docs reversal: `PROJECT_PLAN.md` (L13, L29, L173, L176, L327-328, L334, L367, L387) and `TASKS.md` (M8/M10 vendoring + shadow-binding entries, Follow-ups bridge note) renamed back to esbuild with a cross-ref to this ADR. `OPEN_QUESTIONS.md` Q-2026-05-27-003 updated (forcing consumer → esbuild; resolved/promoted to ADR-0049).
- `CHANGELOG.md` and the `tools/shadow-registry` + `packages/runtime-wasi` CHANGELOGs record the reversal.
- `docs/compat/wasi.md` updated where syscall behaviour changed (`path_open` directory open, `fd_readdir` E_NOTDIR, `fd_read` stdin).

## References

- ADR-0044 (esbuild ships gojs → substitute swc → defer Go bridge). This ADR supersedes its D1 and D2; D3 and D4 unaffected (see D3/D4 above).
- ADR-0049 (WASI cwd/preopen API — promotes Q-2026-05-27-003).
- ADR-0015 (shadow-registry consolidation — the layer the binding lives in).
- ADR-0038 / ADR-0011 (kernel adapter + worker-as-process runtime hosting a WASI guest, unchanged here).
- `OPEN_QUESTIONS.md` Q-2026-05-27-003.
- npm: `@esbuild/wasi-preview1@0.28.0` (`sha512-6Mm1hljxx5NJgqnZupvOLfGGKW+9icZUottY+D1a7+QmddYogj84mAFfgZiobQG4qMbW9tIQubV0lL9XGFKLiw==`).
