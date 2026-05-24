# @rifty/runtime-wasi

WASI preview1 shim. Lets us run WASI binaries (esbuild.wasm, swc.wasm, sqlite, hello.wasm) inside the runtime.

## Surface

```ts
import { Wasi, runWasi } from '@rifty/runtime-wasi';
const wasi = new Wasi({ args: ['hello'], preopens: { '/work': '/' } });
const { instance } = await WebAssembly.instantiate(wasmBytes, wasi.imports);
wasi.start(instance);
```

The shim implements the most common preview1 syscalls: `args_get`, `args_sizes_get`, `environ_get`, `environ_sizes_get`, `fd_read`, `fd_write`, `fd_close`, `fd_seek`, `fd_fdstat_get`, `path_open`, `path_filestat_get`, `proc_exit`, `clock_time_get`, `random_get`. Missing calls return `ENOSYS`.

VFS access is mediated through `@rifty/runtime-js`'s sync filesystem mirror — what works in `fs` works in WASI.
