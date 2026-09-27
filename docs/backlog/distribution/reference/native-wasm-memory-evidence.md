# Native WebAssembly memory — observed-defect repair

Baseline: `f112e5f35d09fb4434d718814644da55b9cfa780`.
User: restore native WebAssembly fidelity in no-COI; deliver green PR.

## Root cause / class

The selected toolchain realm supplied a Memory Proxy through loader/REPL
lexical bindings. Instances retained native constructors; guest bindings did
not. Property-descriptor reads bypassed the Proxy get trap. Native Node
v24.16.0 yields true for all three equality checks; rifty yielded false.

Boundary: owned in-process policy/graph projection (`fault-classes.md`).
Axes: `provenance-lie` (native identity claim), `observable-order` (constructor
and descriptor traps), `sibling-drift` (REPL versus CJS/ESM bindings),
`frozen-assumption` (shared allocation incorrectly treated as thread use).
Transport loss, duplicate delivery and reorder physically excluded: the
mismatch is born synchronously in `sandboxToolchainWebAssembly`, before IPC.
No network/storage/cache/coordination mechanism changes.

Sibling sweep: loader deps → CJS / ESM factories; worker-entry → REPL.
Repo sweep also found SDK capability metadata and Vite 8/cause-projection
fixtures tied to the old named gap. All belong to this repair.

## RED — before implementation

- `pnpm exec vitest run packages/runtime-js/src/internal/sandbox-toolchain-realm.test.ts`:
  1 failed / 11 passed. New guest constructor equality fails (`Object.is`).
- `pnpm test:no-coi tests/no-coi/no-coi-memory-descriptor.spec.ts`:
  1 failed / 1 passed (6.5 s), Chrome 148.0.7778.96.
  REPL/CJS/ESM/installed bin each return false for constructor/binding/global
  and descriptor equality; native browser returns true.
- Existing native headerless oracle passes: a truthy shared descriptor creates
  actual SharedArrayBuffer-backed memory without global SharedArrayBuffer.
  A shared allocation therefore cannot justify the old threaded-WASM guard.

## Decision preparation

Independent read-only DEC-2 agent inspected ADR-0375, native browser oracle,
loader/REPL, WASI and worker_threads boundaries. Recommends native WebAssembly;
rejects moving allocation denial into WASI (shared memory is not thread use).
Requires real Vite 8 terminal-failure proof before accepting removal.
