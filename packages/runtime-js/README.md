# @riftydev/runtime-js

Node-compatible JS runtime that runs inside a Web Worker on top of the host JS engine.

## Public surface

```ts
import { spawnRuntime } from '@riftydev/runtime-js';
import { detectCapabilities } from '@riftydev/runtime-js/env/capabilities';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
```

- `spawnRuntime` — host-side controller. Boots a Worker, exposes `eval(code)`, `fs.readFile()` / `fs.writeFile()`, `reset()`, `dispose()`, and an event stream of stdout/stderr/exit/error.
- `createModuleLoader(vfs, opts)` — pure module loader (CJS + ESM + interop). Browser/worker/Node compatible — tests use it in Node directly.
- `detectCapabilities()` — checks for cross-origin isolation, SAB, OPFS sync handle, etc.

## Layout

```
src/
├── index.ts            # public API
├── host.ts             # main-thread controller (spawnRuntime)
├── worker-entry.ts     # Worker entry point
├── worker-fs-rpc.ts    # Worker-owned VFS read/write RPC
├── protocol.ts         # message types between host and worker
├── env/
│   └── capabilities.ts
├── repl/
│   └── eval.ts
└── module-loader/
    ├── index.ts        # createModuleLoader
    ├── resolver.ts     # Node algorithm (CJS + ESM)
    ├── registry.ts     # module registry + live bindings
    ├── cjs.ts          # CJS loader
    ├── esm.ts          # ESM transform + loader
    └── interop.ts      # CJS↔ESM bridges
```
