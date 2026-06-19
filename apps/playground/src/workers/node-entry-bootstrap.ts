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
 * VFS SELECTION (ADR-0150 — foreground CLI runs in a supervised child that reads
 * the owner fs over sync-RPC; KNOWN GAP closed): when `RIFTY_REMOTE_FS=1` the
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
 * NOTE: `initBackend()` is NOT called here — the child reads AND WRITES the owner
 * store via fs.* sync-RPC (each handler atomic, serialized on the owner's single
 * JS thread), never opening its OWN OPFS handle. So the single-OPFS-writer
 * invariant holds (the owner is the only OPFS writer); the hazard avoided is a
 * SECOND OPFS handle, not all writes — a `node x.js` calling fs.writeFileSync does
 * write, over RPC.
 */

import { readKernelSyncApi } from '@riftydev/kernel';
import { dispatchToPort, listPorts, serveCrossRealmPreview } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { awaitDrain, installConsole, installRemoteSyncFs } from '@riftydev/runtime-js';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { syncMirror } from '@riftydev/vfs';
import { runNodeProgramLifecycle } from './node-program-lifecycle.ts';
import { installLoudStdin } from './node-stdin-guard.ts';

const proc = globalThis.process;
const entryPath = proc.argv[1];
if (typeof entryPath !== 'string' || entryPath === '') {
  throw new Error('node-entry-bootstrap: missing entry path (process.argv[1])');
}

// A spawned Node CLI's console.log belongs on its stdout (kernel stdio port →
// owner pty → terminal). Without this, console output vanishes into the worker
// realm's devtools console (ADR-0150 — cowsay etc. print via console.log).
installConsole({
  stdout: (chunk) => proc.stdout.write(chunk),
  stderr: (chunk) => proc.stderr.write(chunk),
});

// ADR-0150: when spawned as a supervised child (RIFTY_REMOTE_FS=1) that reads the
// owner fs over sync-RPC, make the owner store this realm's sync mirror — both the
// module loader AND node:fs read it.
if (proc.env.RIFTY_REMOTE_FS === '1') {
  const syncApi = readKernelSyncApi();
  if (syncApi === null) {
    throw new Error(
      'node-entry: RIFTY_REMOTE_FS=1 but no kernel sync call published — cannot reach the owner store',
    );
  }
  installRemoteSyncFs(syncApi.call);
}

// `node <file>` server-capable path (ADR-0154): the child spawns serve:true, so
// the bootstrap (not the kernel drain hook) owns the run-vs-serve decision. Net
// builtins are registered unconditionally here — http/net are needed both for
// servers AND for client scripts that import them; the lifecycle decides
// drain-exit vs stay-alive from whether the entry registered a port.
//
// The unhandledrejection trap + drain hook are ALREADY installed in this realm at
// module top-level in kernel-worker-entry.ts (`installEventLoopKeepalive()`, beside
// `installTimerGlobals()` — runs at worker module load, before any spawn; NOT in the
// pre-entry hook). For a run-to-completion script (no listen) `awaitDrain` surfaces a
// detached async rejection loudly (stderr + exit 1). A served entry returns without
// awaiting the drain, so its detached rejection surfaces via the realm's default
// `unhandledrejection` reporting (the keepalive trap deliberately does not
// preventDefault) — never silently swallowed either way.
//
// `proc` is the ONE spec-seeded rich process the pre-entry seam installed (ADR-0157):
// correct argv/cwd/stdin + fork-IPC `send`. No swap, so `installLoudStdin(proc)` and
// `proc.cwd()` act on the SAME object user code reads. The else-branch (.bin/execSync)
// already has Buffer + nextTick from the gated pre-entry install; the RIFTY_NODE_SERVE
// branch additionally registers net builtins + the stdin guard (not needed there).
if (proc.env.RIFTY_NODE_SERVE === '1') {
  registerNetBuiltins();
  // Interactive stdin is not forwarded to a `node <file>` child (ADR-0154 §5,
  // ADR-0157 §4): make the consume surface throw loudly instead of hanging on
  // input that never arrives (Fidelity — no silent divergence).
  // backlog/kernel/worker-per-process-residuals + terminal/raw-stdin-deferred-items.
  installLoudStdin(proc);
  await runNodeProgramLifecycle({
    runEntry: () => runNodeEntry({ vfs: syncMirror(), entryPath, cwd: proc.cwd(), bin: false }),
    listPorts: () => listPorts(),
    awaitDrain: () => awaitDrain(),
    servePreview: (port) =>
      serveCrossRealmPreview(port, async (request) => dispatchToPort(port, request)),
    postListening: (ports) => proc.send?.({ type: 'rifty:node-listening', ports }),
    readExitCode: () => proc.exitCode,
    exit: (code) => proc.exit(code),
  });
} else {
  await runNodeEntry({
    vfs: syncMirror(),
    entryPath,
    cwd: proc.cwd(),
    bin: proc.env.RIFTY_BIN === '1',
  });
}
