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

## Discriminating browser probes

- Removing the guard alone: real Vite 8.0.16 / Rolldown 1.0.3 installs;
  same-realm Worker warns, child reports `Cannot set property self ... getter`,
  build starts but does not settle within a host-side 30 s bound (39.6 s test).
  This candidate is rejected, not shipped as a diagnostic-only improvement.
- `pnpm test:no-coi tests/no-coi/no-coi-native-clone-probe.spec.ts`:
  Chrome 148.0.7778.96 native dedicated Worker, COI false: memory creation succeeds;
  `structuredClone({memory})`, `structuredClone({buffer: memory.buffer})`, native
  MessagePort postMessage all throw `DataCloneError`, message names COI requirement.
- Node differential clone RED:
  `pnpm exec vitest run packages/runtime-js/src/builtins/worker-threads-toolchain-clone.test.ts`.
  Node snapshots data/messages and throws DataCloneError on function payloads;
  rifty reads no getters, delivers function reference, mutates parent source to 99.
  All three clone seams are required by the observed reference-passing defect.

## Fault matrix

Boundary: same-realm Worker message serialization (owned in-process projection).
Transport loss, duplicate delivery and reorder excluded: synchronous clone
precedes the existing queue, no transport/coordination mechanism added.

| Axis | Operation | Honest outcome / carrier |
|---|---|---|
| provenance-lie / sibling-drift | workerData; queued/direct parent send; child reply | native snapshots; Node differential clone suite |
| observable-order | accessor payload | getter read once at send; same suite |
| corrupt-input | uncloneable payload | native DataCloneError, no delivery; same suite + no-COI browser clone oracle |
| false-fallback | real threaded-WASM launch | no shared-reference fallback/hang; real installed Vite 8 browser fixture |

## Selected repair (ADR-0470)

Native-clone candidate also fails the Vite 8 bound (39.5 s). Upstream
`@emnapi/wasi-threads@1.2.1` `loadWasmModuleToWorker` invokes postMessage inside a
Promise executor; subsequent synchronous WASM blocks processing that rejection.
`allocateUnusedWorker` calls its Worker factory synchronously, before this Promise.
Independent DEC-2 review therefore selects an explicit Worker-construction gap.
The experimental clone code and its experimental tests do not ship.

Worker-construction ceiling RED: unit file below, guard temporarily removed:
2 cases fail because construction does not synchronously throw. Guard restored;
CJS and URL/ESM entry attempts must throw canonical NotImplementedError before
child side effects. Real Vite 8 then terminates, logs the named gap, returns its
unchanged outer WASI-loader Error and produces no dist. No error relabeling.

Final fault carriers replace the candidate clone matrix above:

| Axis | Boundary / operation | Carrier |
|---|---|---|
| provenance-lie / sibling-drift | native WebAssembly through REPL/CJS/ESM/bin | sandbox-toolchain-realm.test.ts + no-coi-memory-descriptor.spec.ts |
| observable-order | descriptor/newTarget evaluation | Node differential sandbox-toolchain-realm.test.ts |
| false-fallback | selected toolchain Worker construction | worker-threads-toolchain-ceiling.test.ts + no-coi-sandbox-build-loop.spec.ts |
| frozen-assumption | shared allocation vs real threaded workload | native Chrome oracle + Vite 7 / Vite 8 installed-bin proof |

No message-transport/storage coordination changes ship. Existing generic
same-realm clone semantics are outside the selected-toolchain repair; its
fallback stays as before. Selected toolchain Workers cannot reach that path.

## GREEN / revert check

- Targeted units: 4 files / 57 tests pass, including existing generic/kernel
  worker_threads and SDK suites.
- Final carriers against original product sources: 4 fail / 1 pass; restored
  implementation: 5 pass. The direct REPL unit bypasses worker-entry injection;
  its original browser RED covers that actual seam.
- `pnpm test:no-coi tests/no-coi/no-coi-memory-descriptor.spec.ts tests/no-coi/no-coi-sandbox-build-loop.spec.ts -g 'descriptor|native WASM allocation|capability and no-COI|package-generic bounded|threaded-WASM: Vite 8|request-identical Vite|non-shared WebAssembly|build parity: headerless'`:
  9 pass (1.7 min). Vite 7 exact COI/no-COI build bytes; Vite 8 terminal
  loader error with named Worker diagnostic and absent dist (8.5 s).
