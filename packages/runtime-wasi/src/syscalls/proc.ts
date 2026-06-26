/**
 * Process-lifecycle, scheduling, env/args, clock, and randomness syscalls.
 *
 * Grouped because none touch the fd table or VFS — all concern the guest's view
 * of the surrounding process (argv/environ, time, exit, randomness).
 *
 * `proc_raise`, `sock_*`, and `poll_oneoff` return `E_NOSYS` — unbacked, but must
 * be PRESENT in the imports table or `WebAssembly.instantiate` raises `LinkError`.
 * See `docs/public/compat/wasi.md`.
 */
import {
  CLOCKID_MONOTONIC,
  CLOCKID_REALTIME,
  E_INVAL,
  E_NOSYS,
  E_SUCCESS,
  type WasiCtx,
  WasiExit,
  enc,
} from './shared.ts';

export function procSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    proc_exit: (code: number) => {
      ctx.exited.value = true;
      ctx.exitCode.value = code;
      throw new WasiExit(code);
    },
    proc_raise: () => E_NOSYS,
    poll_oneoff: () => E_NOSYS,
    sched_yield: () => E_SUCCESS,
    sock_accept: () => E_NOSYS,
    sock_recv: () => E_NOSYS,
    sock_send: () => E_NOSYS,
    sock_shutdown: () => E_NOSYS,
    args_get: (argv: number, argvBuf: number) => {
      const view = ctx.view();
      const bytes = ctx.bytes();
      let off = argvBuf;
      for (let i = 0; i < ctx.args.length; i++) {
        view.setUint32(argv + i * 4, off, true);
        const b = enc.encode(`${ctx.args[i] ?? ''}\0`);
        bytes.set(b, off);
        off += b.length;
      }
      return E_SUCCESS;
    },
    args_sizes_get: (countOut: number, sizeOut: number) => {
      const view = ctx.view();
      view.setUint32(countOut, ctx.args.length, true);
      let size = 0;
      for (const a of ctx.args) size += enc.encode(`${a}\0`).length;
      view.setUint32(sizeOut, size, true);
      return E_SUCCESS;
    },
    environ_get: (envPtr: number, envBuf: number) => {
      const view = ctx.view();
      const bytes = ctx.bytes();
      let off = envBuf;
      let idx = 0;
      for (const k of Object.keys(ctx.env)) {
        view.setUint32(envPtr + idx * 4, off, true);
        const b = enc.encode(`${k}=${ctx.env[k]}\0`);
        bytes.set(b, off);
        off += b.length;
        idx++;
      }
      return E_SUCCESS;
    },
    environ_sizes_get: (countOut: number, sizeOut: number) => {
      const view = ctx.view();
      const keys = Object.keys(ctx.env);
      view.setUint32(countOut, keys.length, true);
      let size = 0;
      for (const k of keys) size += enc.encode(`${k}=${ctx.env[k]}\0`).length;
      view.setUint32(sizeOut, size, true);
      return E_SUCCESS;
    },
    clock_res_get: (id: number, outPtr: number) => {
      // Report 1 µs for REALTIME/MONOTONIC: `Date.now()` is ms, `performance.now()`
      // sub-ms. Higher-precision claims would be dishonest. CPU-time clocks
      // unsupported (see `clock_time_get`).
      if (id === CLOCKID_REALTIME || id === CLOCKID_MONOTONIC) {
        ctx.view().setBigUint64(outPtr, 1000n, true);
        return E_SUCCESS;
      }
      return E_INVAL;
    },
    clock_time_get: (id: number, _precision: bigint, outPtr: number) => {
      let ns: bigint;
      if (id === CLOCKID_REALTIME) {
        ns = BigInt(Date.now()) * 1_000_000n;
      } else if (id === CLOCKID_MONOTONIC) {
        // Floor before scaling so the result stays within u64 after `* 1e6`.
        ns = BigInt(Math.floor(performance.now() * 1e6));
      } else {
        // CPUTIME clocks (PROCESS=2, THREAD=3) have no cheap, honest
        // browser/Node equivalent. Refuse rather than alias to monotonic, which
        // would silently feed wall time to a CPU-time benchmark.
        return E_INVAL;
      }
      ctx.view().setBigUint64(outPtr, ns, true);
      return E_SUCCESS;
    },
    random_get: (ptr: number, len: number) => {
      // `crypto.getRandomValues` REJECTS a view backed by a SharedArrayBuffer
      // ("The provided ArrayBufferView value must not be shared") — and threaded
      // WASI modules (e.g. Rolldown's `@rolldown/binding-wasm32-wasi` emnapi
      // pthread build) run on shared wasm memory. Fill a PRIVATE buffer, then
      // copy into wasm memory (typed-array `.set` is fine on shared buffers).
      // Chunk by 65536 — `getRandomValues`'s per-call byte cap.
      const mem = ctx.bytes();
      const MAX = 65536;
      const scratch = new Uint8Array(Math.min(len, MAX));
      for (let off = 0; off < len; off += MAX) {
        const n = Math.min(MAX, len - off);
        const chunk = n === scratch.length ? scratch : scratch.subarray(0, n);
        crypto.getRandomValues(chunk);
        mem.set(chunk, ptr + off);
      }
      return E_SUCCESS;
    },
  };
}
