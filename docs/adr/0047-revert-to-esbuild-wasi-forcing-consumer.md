# ADR 0047: Revert to esbuild (`@esbuild/wasi-preview1`) as the M8/M10 WASI forcing consumer — supersedes ADR-0044 D1/D2

Status: Accepted
Date: 2026-05-27

## Context

ADR-0044 (Accepted, 2026-05-27) substituted **swc** for **esbuild** as the
M8 vendoring target and the M10 `Vite ↔ <transformer>.wasm` shadow-binding
target, on two premises:

- **D1:** "swc publishes a real WASI build to npm" (exact package "TBD when
  vendored" — the ADR explicitly hedged the name).
- The implicit premise behind the whole switch: "esbuild has no upstream WASI
  build; every published `esbuild-wasm` (0.21.5 / 0.25.0 / 0.28.0) imports
  Go's `js/wasm` (`gojs`) ABI."

Both premises have now been **verified false** at vendoring time — which is
exactly when ADR-0044 D1 said the swc package name "will be verified." The
verification failed for swc and succeeded for esbuild.

### Verified facts (2026-05-27 vendoring spike)

1. **swc has no WASI build.** `@swc/core-wasm32-wasi` → npm 404 (does not
   exist). `@swc/wasm`, `@swc/wasm-typescript`, and `@swc/wasm-typescript-esm`
   are all **wasm-bindgen** modules: they import `__wbindgen_*`, not
   `wasi_snapshot_preview1`. `@riftydev/runtime-wasi` is a WASI-preview1 shim and
   cannot host a wasm-bindgen guest (which needs a JS-side glue module and a
   handle table, not a syscall ABI). swc-via-WASI is therefore impossible
   today.

2. **esbuild HAS a real WASI build:** `@esbuild/wasi-preview1@0.28.0`. The npm
   description reads verbatim: *"The WASI (WebAssembly System Interface)
   preview 1 binary for esbuild, a JavaScript bundler."* The tarball is just
   `package.json` + `README.md` + a ~20 MB `esbuild.wasm`; **zero runtime
   dependencies**. We compiled it and inspected the import section: it imports
   **only** `wasi_snapshot_preview1` (31 imports across `args_*`, `environ_*`,
   `fd_*`, `path_*`, `clock_time_get`, `random_get`, `poll_oneoff`,
   `sched_yield`, `sock_*`, `proc_exit`) — **no** `gojs.*`, **no**
   `__wbindgen_*`, **no** bare `env`/`go` module. It exports `_start` and
   `memory`. It runs end-to-end on `runWasi` (`esbuild --version` → exit 0,
   stdout `0.28.0`).

   This is a **different package** from `esbuild-wasm`. `esbuild-wasm` is the
   Go `js/wasm` (`gojs`) build, and it is the *only* one ADR-0044's audit
   inspected — which is why that audit wrongly concluded "esbuild has no WASI
   build." `@esbuild/wasi-preview1` is a genuine WASIp1 target the esbuild
   project ships separately.

The owner has ratified reversing to esbuild on the strength of these facts.

This is **IRREVERSIBLE per the Reversibility checklist** (it re-points M8/M10
acceptance criteria and a forcing consumer that ADR-0044 had moved), so a new
ADR is required. Per the "ADRs are immutable after merge" rule, this ADR
supersedes the relevant parts of ADR-0044 rather than editing it.

## Decision

### D1: esbuild (`@esbuild/wasi-preview1`) is restored as the M8/M10 forcing consumer — supersedes ADR-0044 D1

The M8 vendoring target and the M10 Vite shadow-binding target are esbuild
again, vendored from `@esbuild/wasi-preview1@0.28.0`. swc is dropped as the
substitute — it has no WASI build to vendor, so ADR-0044 D1's premise does not
hold. The architectural need ADR-0044 articulated ("does our WASI runner host
a real-world TS/JSX transformer?") is satisfied by esbuild, which is the
transformer Vite actually uses.

### D2: Q-2026-05-27-003's forcing consumer reverts to esbuild — supersedes ADR-0044 D2

ADR-0044 D2 re-pointed Q-2026-05-27-003 (WASI preopens/`cwd` API) at swc as
its forcing consumer while keeping the A/B/C options. The forcing consumer
reverts to esbuild. Running esbuild through `runWasi` forced the decision (it
opens its cwd directory and issues `AT_FDCWD`-relative path calls), so the
question is now **resolved** and promoted to **ADR-0049** (Option A —
`cwd?: string`). See ADR-0049 for the API and the runtime-wasi changes.

### D3: ADR-0044 D3 (the Go-runtime / gojs bridge stays deferred) remains valid — and is now moot for esbuild

ADR-0044 D3 parked the `@riftydev/runtime-go-wasm` (`syscall/js` handle protocol,
`wasm_exec.js`-equivalent host shim, GC/goroutine integration) as multi-week
work blocking nothing. **That decision stands.** It is now **moot for
esbuild specifically**: esbuild runs through the existing WASI-preview1 shim
via `@esbuild/wasi-preview1`, which is a real WASI binary — *not* the gojs
`esbuild-wasm`. The Go-runtime bridge would only ever be needed for some
*other* future gojs guest; esbuild no longer motivates it. The Follow-ups
entry in TASKS.md is retained (a future gojs guest may still want it) but its
stated beneficiary ("esbuild") is struck.

### D4: ADR-0044 D4 (the swc switch was docs-only) is unaffected; this ADR ships code

ADR-0044 D4 noted that the swc switch shipped no code. This reversal *does*
ship code: the esbuild.wasm vendoring script + artifact, the shadow-binding
adapter, the runtime-wasi changes that ADR-0049 covers, and the integration +
conformance tests. D4 described ADR-0044's own scope and is not contradicted.

## Alternatives considered

- **Keep swc, find its WASI build later.** Rejected: there is no swc WASI
  build to find. The published swc wasm artifacts are all wasm-bindgen, which
  our preview1 shim structurally cannot host. Waiting indefinitely leaves M8
  open with no path to close.
- **Build `@riftydev/runtime-go-wasm` to run the gojs `esbuild-wasm`.** Rejected
  for the same reason ADR-0044 D3 rejected it (multi-week), and now
  unnecessary: `@esbuild/wasi-preview1` runs on the shim we already have.
- **Vendor esbuild as a runtime npm dependency.** Rejected per the CLAUDE.md
  anti-pattern (bias to build-time scripts over runtime deps). The wasm is
  pulled by a build-time fetch script, pinned by version + integrity, and
  checked in as an artifact — not added to any package's `dependencies`.

## Trade-offs

- **A 19.2 MB binary is checked in.** Accepted: it is the price of an offline,
  reproducible, build-time-vendored toolchain. Pinned by SHA-512 integrity in
  the fetch script; marked `binary` in `.gitattributes`.
- **The shadow-binding targets esbuild's CLI transform surface, not its JS
  API.** Vite's `transform()` (TS/JSX → JS) maps onto `esbuild --loader=ts`
  over stdin. Dep-prebundle bundling (esbuild's `build()`) is a deeper surface
  not wired here — if a future need arises it must run through `runWasi` too
  or throw `NotImplementedError('shadow-registry.esbuild.<feature>')` (no fake
  output).

## Consequences

- New build-time script `tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs`
  vendors `esbuild.wasm` to
  `tools/shadow-registry/vendor/esbuild-wasi-preview1/`.
- New shadow-binding `tools/shadow-registry/src/esbuild-binding.ts`
  (`transformWithEsbuild`, `loadVendoredEsbuildWasm`,
  `ESBUILD_WASM_VENDOR_PATH`) wires Vite's transform surface to
  `runWasi(esbuild.wasm, …)` via dependency injection (no import edge from the
  tool to `@riftydev/runtime-wasi`).
- `@riftydev/runtime-wasi` gains `WasiOptions.cwd`, `AT_FDCWD` resolution,
  directory-open support in `path_open`, `E_NOTDIR` from `fd_readdir` on a
  file fd, and a wired stdin reader — all covered by ADR-0049.
- Docs reversal: `PROJECT_PLAN.md` (L13, L29, L173, L176, L327-328, L334,
  L367, L387) and `TASKS.md` (the M8/M10 vendoring + shadow-binding entries
  and the Follow-ups bridge note) renamed back to esbuild with a cross-ref to
  this ADR. `OPEN_QUESTIONS.md` Q-2026-05-27-003 updated (forcing consumer →
  esbuild; resolved/promoted to ADR-0049).
- `CHANGELOG.md` and the `tools/shadow-registry` + `packages/runtime-wasi`
  CHANGELOGs record the reversal.
- `docs/compat/wasi.md` updated where syscall behaviour changed (`path_open`
  directory open, `fd_readdir` E_NOTDIR, `fd_read` stdin).

## References

- ADR-0044 (esbuild ships gojs → substitute swc → defer Go bridge). This ADR
  supersedes its D1 and D2; D3 and D4 are unaffected (see D3/D4 above).
- ADR-0049 (WASI cwd/preopen API — promotes Q-2026-05-27-003).
- ADR-0015 (shadow-registry consolidation — the layer the binding lives in).
- ADR-0038 / ADR-0011 (the kernel adapter + worker-as-process runtime that
  host a WASI guest, unchanged here).
- `OPEN_QUESTIONS.md` Q-2026-05-27-003.
- npm: `@esbuild/wasi-preview1@0.28.0`
  (`sha512-6Mm1hljxx5NJgqnZupvOLfGGKW+9icZUottY+D1a7+QmddYogj84mAFfgZiobQG4qMbW9tIQubV0lL9XGFKLiw==`).
