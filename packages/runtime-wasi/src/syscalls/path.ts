/**
 * Path-resolving WASI preview1 syscalls. Split across three sibling files
 * (ADR-0024 file-size budget):
 *   - {@link ./path-open.ts}     — `path_open`
 *   - {@link ./path-filestat.ts} — `path_filestat_get`, `path_filestat_set_times`
 *   - {@link ./path-mutate.ts}   — create/unlink/rmdir/rename + link stubs
 *
 * Shared helpers (error mapping, fd resolution, default rights bag) live in
 * {@link ./path-helpers.ts} and are also re-exported here for the test suite.
 *
 * All path-relative calls resolve against the base-fd preopen and consult
 * the shared sync VFS mirror (ADR-0014 — `@rifty/vfs` owns the mirror).
 */
import { pathFilestatSyscalls } from './path-filestat.ts';
import { pathMutateSyscalls } from './path-mutate.ts';
import { pathOpenSyscall } from './path-open.ts';
import type { WasiCtx } from './shared.ts';

export { errToWasiErrno } from './path-helpers.ts';

export function pathSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    path_open: pathOpenSyscall(ctx),
    ...pathFilestatSyscalls(ctx),
    ...pathMutateSyscalls(ctx),
  };
}
