/**
 * Time and randomness syscalls: `clock_time_get`, `random_get`. Reads from
 * `performance.now()` and `crypto.getRandomValues` — both available in both
 * the browser and Node runtimes.
 */
import { E_SUCCESS, type WasiCtx } from './shared.ts';

export function clockSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    clock_time_get: (_id: number, _precision: bigint, outPtr: number) => {
      const ns = BigInt(Math.floor(performance.now() * 1e6));
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
