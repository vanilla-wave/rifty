# @riftydev/runtime-wasi

WASI preview1 shim. Lets us run WASI binaries (esbuild.wasm, swc.wasm, sqlite, hello.wasm) inside the runtime.

## Surface

```ts
import { Wasi, runWasi } from '@riftydev/runtime-wasi';
const wasi = new Wasi({ args: ['hello'], preopens: { '/work': '/' } });
const { instance } = await WebAssembly.instantiate(wasmBytes, wasi.imports);
wasi.start(instance);
```

The shim exposes ALL canonical preview1 syscalls in `wasi_snapshot_preview1` — partly so toolchains like esbuild/tsc don't fail at `WebAssembly.instantiate` with a `LinkError`, partly because honest `E_NOSYS` is better than a missing symbol. The full per-syscall status table lives in [`docs/public/compat/wasi.md`](../../docs/public/compat/wasi.md).

VFS access is mediated through `@riftydev/vfs`'s sync filesystem mirror (`syncMirror()`, ADR-0014) — what works in `fs` works in WASI.
