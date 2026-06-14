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
 * KNOWN GAP (ADR-0143): `syncMirror()` here is this worker realm's OWN empty
 * store — the pre-entry hook installs NO fs mirror, and the shell's installed
 * `node_modules` live in PAGE memory (no shared OPFS), so `runNodeEntry` ENOENTs
 * end-to-end. The worker-VFS transport is settled as D (owner-worker) in
 * ADR-0143, not yet built. (This comment previously claimed a "SAB-backed sync
 * mirror" was installed here — it never was.)
 *
 * `RIFTY_BIN=1` marks a `node_modules/.bin/<name>` launcher shim (run its
 * import target). Run-to-completion: when the entry's top-level settles the
 * realm exits and the kernel posts the exit code; a throw propagates to the
 * kernel worker-entry, which surfaces it on stderr (exit 1) — never silent.
 */

import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { syncMirror } from '@riftydev/vfs';

const proc = globalThis.process;
const entryPath = proc.argv[1];
if (typeof entryPath !== 'string' || entryPath === '') {
  throw new Error('node-entry-bootstrap: missing entry path (process.argv[1])');
}

await runNodeEntry({
  vfs: syncMirror(),
  entryPath,
  cwd: proc.cwd(),
  bin: proc.env.RIFTY_BIN === '1',
});
