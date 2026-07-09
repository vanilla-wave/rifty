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

import { getKernelDispatcher, readKernelSyncApi, setKernelWorkerUrl } from '@riftydev/kernel';
import { dispatchToPort, listPorts, onRegistryChange, serveCrossRealmPreview } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import {
  awaitDrain,
  installConsole,
  installRemoteSyncFs,
  installRuntimeJsFsHandlers,
} from '@riftydev/runtime-js';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { setNodeEntryWorkerUrl } from '@riftydev/runtime-js/builtins/node-entry-url';
import { syncMirror } from '@riftydev/vfs';
import { installSqliteWasmSyncProvider } from '../glue/sqlite-wasm-provider.ts';
import { installEsbuildBridge } from './esbuild-host.ts';
import { runNodeProgramLifecycle } from './node-program-lifecycle.ts';
import { installLoudStdin } from './node-stdin-guard.ts';
import { binNameOf, prepareViteCli, viteCliMode } from './vite-cli-prep.ts';
import { installBundleLocalBuffer } from './worker-runtime-globals.ts';

const proc = globalThis.process;
const entryPath = proc.argv[1];
if (typeof entryPath !== 'string' || entryPath === '') {
  throw new Error('node-entry-bootstrap: missing entry path (process.argv[1])');
}

// Realign globalThis.Buffer with THIS bundle's `require('buffer')` so a `node x.js`
// server using express/etag (which reads the GLOBAL Buffer) doesn't trip the
// dual-copy `Buffer.isBuffer` mismatch in a production build — the kernel pre-entry
// hook installed the kernel-worker-entry bundle's copy. See installBundleLocalBuffer.
installBundleLocalBuffer();

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
  const remoteFs = installRemoteSyncFs(syncApi.call);
  // A nested worker (Rolldown's WASI pthread pool under a foreground
  // `.bin/vite@8`) lands its fs.* sync-RPC on THIS realm's dispatcher; the
  // child has no store of its own, so relay to the owner view — mirror of
  // dev-server-child-bootstrap. Without it the pthread crashes on its first
  // `fs.statOrNull` ("SyncRpcDispatcher: no handler").
  installRuntimeJsFsHandlers(getKernelDispatcher(), () => remoteFs);
}

// Consume the spawner-forwarded worker URLs — forwarding alone is inert:
// worker_threads gates real `kernel.spawnWorker` children on
// `getKernelWorkerUrl()/getNodeEntryWorkerUrl()`, and with them unset a
// foreground `.bin/vite@8` silently degraded to the same-realm fallback
// (backlog playground/vite8-cli-nested-worker-boot).
if (typeof proc.env.RIFTY_KERNEL_WORKER_URL === 'string' && proc.env.RIFTY_KERNEL_WORKER_URL) {
  setKernelWorkerUrl(proc.env.RIFTY_KERNEL_WORKER_URL);
}
if (
  typeof proc.env.RIFTY_NODE_ENTRY_WORKER_URL === 'string' &&
  proc.env.RIFTY_NODE_ENTRY_WORKER_URL
) {
  setNodeEntryWorkerUrl(proc.env.RIFTY_NODE_ENTRY_WORKER_URL);
}

// The shadow-registry esbuild shim overlays EVERY installed `esbuild` package
// (mode-independent, ADR-0188) and delegates to this realm's host bridge — so
// the bridge must exist for every node child, or a plain
// `node -e "require('esbuild').transform(...)"` dies on "host bridge missing"
// while the vite paths work. Install stays lazy (13.5 MB wasm loads on first
// API call only).
installEsbuildBridge();

const viteMode =
  proc.env.RIFTY_BIN === '1' && binNameOf(entryPath) === 'vite'
    ? viteCliMode(proc.argv.slice(2))
    : null;
if (viteMode !== null) {
  await prepareViteCli(proc.cwd());
}

const previewScope = proc.env.RIFTY_PREVIEW_SCOPE || undefined;

// `node <file>` server-capable path (ADR-0155): the child spawns serve:true, so
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
  // node:sqlite for any user program — registered always, engine paid only at
  // first require via the sync wasm provider.
  registerSqliteBuiltin();
  installSqliteWasmSyncProvider();
  // Interactive stdin is not forwarded to a `node <file>` child (ADR-0155 §5,
  // ADR-0157 §4): make the consume surface throw loudly instead of hanging on
  // input that never arrives (Fidelity — no silent divergence).
  // backlog/kernel/worker-per-process-residuals + terminal/raw-stdin-deferred-items.
  installLoudStdin(proc);
  await runNodeProgramLifecycle({
    runEntry: () =>
      runNodeEntry({
        vfs: syncMirror(),
        entryPath,
        cwd: proc.cwd(),
        bin: proc.env.RIFTY_BIN === '1',
      }),
    listPorts: () => listPorts(),
    onPortsChange: (cb) => onRegistryChange(cb),
    awaitDrain: () => awaitDrain(),
    servePreview: (port) =>
      serveCrossRealmPreview(
        port,
        async (request) => dispatchToPort(port, request),
        previewScope === undefined ? {} : { scope: previewScope },
      ),
    postListening: (ports) =>
      proc.send?.({
        type: 'rifty:node-listening',
        ports,
        ...(previewScope === undefined ? {} : { previewScope }),
      }),
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
  // Honor process.exitCode on a clean return (Node parity, ADR-0157 D4): the kernel
  // reaps a no-throw return as exit 0, so a `.bin`/execSync CLI that set a non-zero
  // process.exitCode must surface it (proc.exit throws RIFTY_PROCESS_EXIT → kernel
  // maps the code). exitCode 0 stays a clean exit 0.
  if (proc.exitCode) proc.exit(proc.exitCode);
}
