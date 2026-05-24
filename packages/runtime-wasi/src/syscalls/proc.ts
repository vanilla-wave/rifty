/**
 * Process-lifecycle and scheduling syscalls: `proc_exit`, `sched_yield`,
 * `poll_oneoff`. `proc_exit` flips the exit flags and raises {@link WasiExit}
 * so the outer `start()` loop sees the unwind.
 */
import { E_NOSYS, E_SUCCESS, type WasiCtx, WasiExit } from './shared.ts';

export function procSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    proc_exit: (code: number) => {
      ctx.exited.value = true;
      ctx.exitCode.value = code;
      throw new WasiExit(code);
    },
    poll_oneoff: () => E_NOSYS,
    sched_yield: () => E_SUCCESS,
  };
}
