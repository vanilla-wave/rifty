/**
 * Time and randomness syscalls: `clock_time_get`, `random_get`. Reads from
 * `performance.now()` and `crypto.getRandomValues` — both available in both
 * the browser and Node runtimes.
 */
import { CLOCKID_MONOTONIC, CLOCKID_REALTIME, E_INVAL, E_SUCCESS, type WasiCtx } from './shared.ts';

export function clockSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
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
