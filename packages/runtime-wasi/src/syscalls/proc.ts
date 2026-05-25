/**
 * Process-lifecycle, scheduling, env/args, clock, and randomness syscalls.
 *
 * Grouped because none of them touch the fd table or VFS — they're all about
 * the WASI guest's view of the surrounding process (its argv/environ, its
 * sense of time, its ability to exit, its access to randomness).
 *
 * - `proc_exit` flips the exit flags and raises {@link WasiExit} so the outer
 *   `start()` loop sees the unwind.
 * - `proc_raise` (signal raise), `sock_*` (BSD socket ops), and `poll_oneoff`
 *   return `E_NOSYS` — not backed by the in-browser runtime, but they must
 *   be PRESENT in the imports table so `WebAssembly.instantiate` doesn't
 *   `LinkError`. See `docs/compat/wasi.md`.
 * - `args_*` and `environ_*` read the immutable `args` / `env` arrays.
 * - `clock_*` and `random_get` use `Date.now()` / `performance.now()` /
 *   `crypto.getRandomValues` — all available in both the browser and Node
 *   runtimes.
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
      // Report 1 µs (1000 ns) for both REALTIME and MONOTONIC — `Date.now()`
      // is ms, `performance.now()` is sub-millisecond. Higher-precision
      // claims would be dishonest; CPU-time clocks are not supported here
      // (see `clock_time_get` rationale).
      if (id === CLOCKID_REALTIME || id === CLOCKID_MONOTONIC) {
        ctx.view().setBigUint64(outPtr, 1000n, true);
        return E_SUCCESS;
      }
      return E_INVAL;
    },
    clock_time_get: (id: number, _precision: bigint, outPtr: number) => {
      let ns: bigint;
      if (id === CLOCKID_REALTIME) {
        // Wall-clock since unix epoch, in nanoseconds. `Date.now()` is ms.
        ns = BigInt(Date.now()) * 1_000_000n;
      } else if (id === CLOCKID_MONOTONIC) {
        // Monotonic process uptime in nanoseconds. `performance.now()` is ms
        // with sub-millisecond resolution. Floor before scaling so we stay
        // within u64 even after `* 1e6`.
        ns = BigInt(Math.floor(performance.now() * 1e6));
      } else {
        // CLOCKID_PROCESS_CPUTIME_ID (2) and CLOCKID_THREAD_CPUTIME_ID (3)
        // have no portable browser/Node equivalent that's both cheap and
        // honest. We refuse instead of silently aliasing to monotonic — a
        // benchmark that relied on CPU time would otherwise get wall time
        // and silently mislead.
        return E_INVAL;
      }
      ctx.view().setBigUint64(outPtr, ns, true);
      return E_SUCCESS;
    },
    random_get: (ptr: number, len: number) => {
      const bytes = ctx.bytes().subarray(ptr, ptr + len);
      crypto.getRandomValues(bytes);
      return E_SUCCESS;
    },
  };
}
