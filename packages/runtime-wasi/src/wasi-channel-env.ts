/**
 * WASI-guest channel env keys — the wire between {@link createWasiProcess}
 * (parent, writes them onto the spawn env) and `worker-entry` (child, reads
 * them to fetch the WASM + preopens).
 *
 * Own module, ZERO side effects, so the parent-side consumer
 * ({@link ../process-handle.ts}) can read the keys WITHOUT importing
 * `worker-entry.ts` — whose top-level await runs the WASI guest. Keeping
 * `process-handle` (re-exported from the package index) off `worker-entry`
 * means the side-effectful entry stays reachable only via its own
 * `@riftydev/runtime-wasi/worker-entry` subpath (the wasi worker bundle), and
 * never leaks into a runtime-js worker's static graph through `node:wasi`.
 */

/** Env-key carrying the URL of the WASM module to fetch. */
export const WASI_WASM_URL_ENV = '__RIFTY_WASI_WASM_URL' as const;

/**
 * Env-key carrying the JSON-encoded preopens map. Optional; when absent the
 * guest gets no preopens (a typical M8 toolchain spawn would set it to
 * `{ '/': '/' }` so the guest's `/` aliases the host VFS root).
 */
export const WASI_PREOPENS_ENV = '__RIFTY_WASI_PREOPENS' as const;
