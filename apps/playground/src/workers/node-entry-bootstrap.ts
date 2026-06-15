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
 * VFS SELECTION (ADR-0150 P6a, KNOWN GAP closed): when `RIFTY_REMOTE_FS=1` the
 * child installs the owner store as its GLOBAL sync mirror via
 * `installRemoteSyncFs`. This ensures BOTH the module loader AND `node:fs`
 * builtins (which read `syncMirror()`) route to the owner over RPC — closing the
 * ENOENT gap that arose when only the loader received the remote VFS.
 *
 * `RIFTY_BIN=1` marks a `node_modules/.bin/<name>` launcher shim (run its
 * import target). Run-to-completion: when the entry's top-level settles the
 * realm exits and the kernel posts the exit code; a throw propagates to the
 * kernel worker-entry, which surfaces it on stderr (exit 1) — never silent.
 *
 * NOTE: `initBackend()` is NOT called here — the child reads via RPC, never its
 * own OPFS, avoiding the concurrent-OPFS-writer hazard.
 */

import { readKernelSyncApi } from '@riftydev/kernel';
import { installRemoteSyncFs } from '@riftydev/runtime-js';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { syncMirror } from '@riftydev/vfs';

const proc = globalThis.process;
const entryPath = proc.argv[1];
if (typeof entryPath !== 'string' || entryPath === '') {
  throw new Error('node-entry-bootstrap: missing entry path (process.argv[1])');
}

// ADR-0150 P6a: when spawned as a supervised child (RIFTY_REMOTE_FS=1), make the
// owner store this realm's sync mirror — both the module loader AND node:fs read it.
if (proc.env.RIFTY_REMOTE_FS === '1') {
  const syncApi = readKernelSyncApi();
  if (syncApi === null) {
    throw new Error(
      'node-entry: RIFTY_REMOTE_FS=1 but no kernel sync call published — cannot reach the owner store',
    );
  }
  installRemoteSyncFs(syncApi.call);
}

await runNodeEntry({
  vfs: syncMirror(),
  entryPath,
  cwd: proc.cwd(),
  bin: proc.env.RIFTY_BIN === '1',
});
