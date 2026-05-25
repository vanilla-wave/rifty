/**
 * Process-lifecycle, scheduling, and socket syscalls.
 *
 * `proc_exit` flips the exit flags and raises {@link WasiExit} so the outer
 * `start()` loop sees the unwind. `proc_raise` (signal raise), `sock_*`
 * (BSD socket ops), and `poll_oneoff` return E_NOSYS — these aren't backed
 * by the in-browser runtime, but they must be PRESENT in the imports table
 * so `WebAssembly.instantiate` doesn't `LinkError`. See `docs/compat/wasi.md`.
 */
import { E_NOSYS, E_SUCCESS, type WasiCtx, WasiExit } from './shared.ts';

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
  };
}
