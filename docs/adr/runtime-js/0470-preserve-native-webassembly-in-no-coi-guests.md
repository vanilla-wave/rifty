# ADR 0470: Preserve native WebAssembly in no-COI guests

Status: Accepted
Date: 2026-09-27

> Native WebAssembly; explicit failure at unsupported toolchain Worker construction.

## Context

ADR-0375 D4 rejected truthy `MemoryDescriptor.shared` through lexical Proxies.
Native Node v24.16.0 and headerless Chrome 148.0.7778.96 preserve constructor /
namespace / property-descriptor identity; the Proxy did not. Chrome permits
shared allocation without COI. Allocation alone does not imply thread use.

Commands/results: [repair evidence](../../backlog/distribution/reference/native-wasm-memory-evidence.md).
Independent DEC-2 review inspected native oracles, loader/REPL, WASI,
Worker boundaries and the executed alternative failures before selection.

## Candidates

- Keep / deepen Memory Proxy: rejected by identity RED; it adds descriptor /
  newTarget observations unrelated to memory use.
- Native WebAssembly only: rejected by real Vite 8 probe. Same-realm child
  fails and the build does not settle within the host's 30-second bound.
- Native clone at same-realm message send: rejected by a second real Vite 8
  probe. Chrome rejects shared transfer, but emnapi catches it inside a Promise;
  synchronous WASM blocks rejection handling. No clone mechanism ships.
- Native WebAssembly + synchronous Worker refusal: selected. Independent
  execution is unavailable; reject its actual construction before child launch.
- Real no-COI Node worker backend: requires a new VFS/runtime architecture;
  this repair does not claim that capability.

## Decision

1. Supersede ADR-0375 D4 and D6's shared-allocation rejection clause. Remove
   Memory Proxy and CJS/ESM/REPL lexical WebAssembly substitution entirely.
2. Supersede the ADR-0011 same-realm fallback only in the selected production
   toolchain realm: `new worker_threads.Worker` synchronously throws canonical
   `NotImplementedError('worker_threads.Worker')` before allocating/scheduling
   a child. This explicitly revokes the prior degraded no-COI Worker capability,
   including ordinary JS Workers. Generic fallback and COI kernel paths stay.
3. SDK metadata marks Worker throwing. Threaded-WASM metadata identifies the
   same Worker gap, not the retired `toolchain.threaded-wasm` error feature.
   Shared-memory allocation itself remains native and may succeed.
4. Preserve dependency errors. The real Rolldown loader logs the named Worker
   gap then rejects with its own WASI-loader error; no cause/text fabrication.
   Existing bounded projection still handles genuine retained named causes.

## Consequences

- Guest Memory constructor/namespace/descriptors have native identity.
- Shared allocation and single-agent access remain possible without COI.
- Programs requiring independent Node Workers fail explicitly, even without WASM.
- Vite 7 remains the supported build oracle; real Vite 8 fails without hanging.
- No package/version checks, timeout mechanism or partial clone serializer.
