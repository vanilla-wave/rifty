/**
 * Node-entry worker bootstrap (Opt-Y, ADR-0137) — the `kind:'url'` entry that
 * runs a VFS Node program inside a kernel Worker through the runtime-js module
 * loader.
 *
 * Both the shell `.bin` executor and `child_process`/`execSync` spawn this: by
 * the time it runs, the kernel pre-entry hook (kernel-worker-entry.ts) has
 * installed the Node `process` shim, so we read the entry path from
 * `process.argv[1]` and run it via `runNodeEntry` — shebang stripped, relative
 * `import`/`require` resolved against the VFS, which the kernel's raw
 * `kind:'source'` (`new AsyncFunction`) path cannot do.
 *
 * VFS SELECTION (ADR-0150 P6a): when `RIFTY_REMOTE_FS=1` the child reads the
 * OWNER store over `fs.*` sync-RPC (`SyncRpcFsSync`), closing the ENOENT gap
 * documented here previously. Without it, falls back to the realm's own (empty)
 * sync mirror — legacy path for page-side per-bin executor + execSync.
 *
 * `RIFTY_BIN=1` marks a `node_modules/.bin/<name>` launcher shim (run its
 * import target). Run-to-completion: when the entry's top-level settles the
 * realm exits and the kernel posts the exit code; a throw propagates to the
 * kernel worker-entry, which surfaces it on stderr (exit 1) — never silent.
 */

import { readKernelSyncApi } from '@riftydev/kernel';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { syncMirror } from '@riftydev/vfs';
import { selectEntryVfs } from './select-entry-vfs.ts';

const proc = globalThis.process;
const entryPath = proc.argv[1];
if (typeof entryPath !== 'string' || entryPath === '') {
  throw new Error('node-entry-bootstrap: missing entry path (process.argv[1])');
}

const syncApi = readKernelSyncApi();
const vfs = selectEntryVfs({
  remoteFs: proc.env.RIFTY_REMOTE_FS === '1',
  call: syncApi ? syncApi.call : null,
  localVfs: syncMirror,
});

await runNodeEntry({
  vfs,
  entryPath,
  cwd: proc.cwd(),
  bin: proc.env.RIFTY_BIN === '1',
});
