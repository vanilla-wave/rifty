/**
 * Link-time surface check: every preview1 syscall a real toolchain
 * (esbuild.wasm, tsc.wasm, swc.wasm) imports must appear in
 * `wasi_snapshot_preview1`. Missing names blow up at `WebAssembly.instantiate`
 * with a `LinkError`, which is the failure mode this test guards against.
 *
 * We don't assert behaviour here — that lives in `fd.test.ts` and
 * `path.test.ts`. We only assert presence so the matrix in
 * `docs/public/compat/wasi.md` stays honest.
 */
import { describe, expect, it } from 'vitest';
import { Wasi } from '../wasi.ts';

/**
 * Canonical preview1 syscall list. Source: WASI snapshot 1 spec / witx. Tools
 * generally import a subset of these; we expose ALL of them so a guest never
 * fails to instantiate. Unsupported ones return `E_NOSYS` at call time.
 */
const PREVIEW1 = [
  'args_get',
  'args_sizes_get',
  'environ_get',
  'environ_sizes_get',
  'clock_res_get',
  'clock_time_get',
  'fd_advise',
  'fd_allocate',
  'fd_close',
  'fd_datasync',
  'fd_fdstat_get',
  'fd_fdstat_set_flags',
  'fd_fdstat_set_rights',
  'fd_filestat_get',
  'fd_filestat_set_size',
  'fd_filestat_set_times',
  'fd_pread',
  'fd_prestat_get',
  'fd_prestat_dir_name',
  'fd_pwrite',
  'fd_read',
  'fd_readdir',
  'fd_renumber',
  'fd_seek',
  'fd_sync',
  'fd_tell',
  'fd_write',
  'path_create_directory',
  'path_filestat_get',
  'path_filestat_set_times',
  'path_link',
  'path_open',
  'path_readlink',
  'path_remove_directory',
  'path_rename',
  'path_symlink',
  'path_unlink_file',
  'poll_oneoff',
  'proc_exit',
  'proc_raise',
  'sched_yield',
  'random_get',
  'sock_accept',
  'sock_recv',
  'sock_send',
  'sock_shutdown',
] as const;

describe('wasi_snapshot_preview1 link surface', () => {
  it('exposes every canonical preview1 syscall as a function', () => {
    const wasi = new Wasi();
    const ns = wasi.imports.wasi_snapshot_preview1 as WebAssembly.ModuleImports;
    const missing: string[] = [];
    for (const name of PREVIEW1) {
      if (typeof ns[name] !== 'function') missing.push(name);
    }
    expect(missing).toEqual([]);
  });
});
