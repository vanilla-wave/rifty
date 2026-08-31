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
 * the owner fs over sync-RPC; KNOWN GAP closed): the entry-scoped launch
 * bootstrap selects the owner store as this realm's GLOBAL sync mirror via
 * `installRemoteSyncFs`. This ensures BOTH the module loader AND `node:fs`
 * builtins (which read `syncMirror()`) route to the owner over RPC — closing the
 * ENOENT gap that arose when only the loader received the remote VFS.
 *
 * The entry-scoped launch bootstrap marks `node_modules/.bin/<name>` launcher
 * shims (run their import target). Run-to-completion: when the entry's top-level
 * settles the realm exits and the kernel posts the exit code; a throw propagates
 * to the kernel worker-entry, which surfaces it on stderr (exit 1) — never silent.
 *
 * NOTE: `initBackend()` is NOT called here — the child reads AND WRITES the owner
 * store via fs.* sync-RPC (each handler atomic, serialized on the owner's single
 * JS thread), never opening its OWN OPFS handle. So the single-OPFS-writer
 * invariant holds (the owner is the only OPFS writer); the hazard avoided is a
 * SECOND OPFS handle, not all writes — a `node x.js` calling fs.writeFileSync does
 * write, over RPC.
 */

import { getKernelDispatcher, globalProcessManager, readKernelSyncApi } from '@riftydev/kernel';
import { dispatchToPort, listPorts, onRegistryChange, serveCrossRealmPreview } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { awaitDrain, installConsole, releaseNodeEvalDrainOwnership } from '@riftydev/runtime-js';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { readNodeEntryBootstrap } from '@riftydev/runtime-js/builtins/node-entry-url';
import {
  adoptNodeProcessBootstrap,
  postNodeProcessListeningControl,
} from '@riftydev/runtime-js/builtins/process';
import { syncMirror } from '@riftydev/vfs';
import { installOwnerSyncRuntimeHandlers } from '../glue/owner-sync-runtime-handlers.ts';
import { installSqliteWasmSyncProvider } from '../glue/sqlite-wasm-provider.ts';
import { installNodeEntryRemoteFs } from './node-entry-remote-fs.ts';
import { prepareNodeEntryRuntime } from './node-entry-runtime-preparation.ts';
import { runNodeProgramLifecycle } from './node-program-lifecycle.ts';
import {
  installNodeWorkerRuntimeConfig,
  readNodeWorkerRuntimeConfig,
} from './node-worker-runtime-config.ts';
import { installBundleLocalBuffer, installBundleLocalCwd } from './worker-runtime-globals.ts';

const proc = globalThis.process;
adoptNodeProcessBootstrap(proc, globalProcessManager);
const nodeEntryBootstrap = readNodeEntryBootstrap();
const launch = nodeEntryBootstrap.launch;
const nodeWorkerRuntimeConfig = readNodeWorkerRuntimeConfig(
  nodeEntryBootstrap.hostRuntime,
  'node-entry-bootstrap',
);
installNodeWorkerRuntimeConfig(nodeWorkerRuntimeConfig);
const bin = launch.kind === 'program' && launch.bin;
const nodeServe = launch.kind === 'eval' || (launch.kind === 'program' && launch.nodeServe);
const previewScope = launch.kind === 'worker-thread' ? undefined : launch.previewScope;
const entryPath = launch.kind === 'eval' ? undefined : proc.argv[1];
function requiredEntryPath(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error('node-entry-bootstrap: missing entry path (process.argv[1])');
  }
  return value;
}
if (launch.kind !== 'eval') requiredEntryPath(entryPath);

// Realign globalThis.Buffer with THIS bundle's `require('buffer')` so a `node x.js`
// server using express/etag (which reads the GLOBAL Buffer) doesn't trip the
// dual-copy `Buffer.isBuffer` mismatch in a production build — the kernel pre-entry
// hook installed the kernel-worker-entry bundle's copy. See installBundleLocalBuffer.
installBundleLocalBuffer();
// The same split affects the fs/path cwd cell: seed this bundle from the
// already-installed process before nodemon probes relative entry paths.
installBundleLocalCwd(proc.cwd());

// A spawned Node CLI's console.log belongs on its stdout (kernel stdio port →
// owner pty → terminal). Without this, console output vanishes into the worker
// realm's devtools console (ADR-0150 — cowsay etc. print via console.log).
installConsole({
  stdout: (chunk) => proc.stdout.write(chunk),
  stderr: (chunk) => proc.stderr.write(chunk),
});

// ADR-0150: a supervised child that reads the owner fs over sync-RPC makes the
// owner store this realm's sync mirror — both the module loader AND node:fs read it.
if (launch.remoteFs) {
  const syncApi = readKernelSyncApi();
  if (syncApi === null) {
    throw new Error('node-entry: remote owner fs requested but no kernel sync call published');
  }
  const remoteFs = installNodeEntryRemoteFs(syncApi.call, syncApi.callBinary, launch.remoteFsRoot);

  // This realm owns the dispatcher for every kernel Worker it creates. Relay
  // the upstream-authoritative mirror so a nested Worker can load its entry/fs
  // without double-applying remoteFsRoot. execSync's local ENOENT preflight
  // receives project-logical paths, so only its resolver uses the scoped mirror.
  installOwnerSyncRuntimeHandlers(getKernelDispatcher(), () => remoteFs, undefined, {
    getVfs: () => syncMirror(),
  });
}

// Every recursive Node entry gets the same host-provided sqlite engine source.
// Install before Vite prep and both run/serve branches: user code may require
// node:sqlite immediately, and a late provider cannot repair a cached namespace.
registerSqliteBuiltin();
installSqliteWasmSyncProvider(nodeWorkerRuntimeConfig.sqliteWasmUrl);

if (launch.kind === 'eval') {
  await prepareNodeEntryRuntime({
    kind: 'eval',
    root: proc.cwd(),
    runtimeBindings: launch.runtimeBindings ?? [],
    fs: syncMirror(),
  });
} else {
  await prepareNodeEntryRuntime({
    bin,
    root: proc.cwd(),
    args: proc.argv.slice(2),
    entryPath: requiredEntryPath(entryPath),
    runtimeBindings: launch.runtimeBindings ?? [],
    fs: syncMirror(),
  });
}

const runEntry = (): Promise<void> =>
  launch.kind === 'eval'
    ? runNodeEntry({
        kind: 'eval',
        vfs: syncMirror(),
        cwd: proc.cwd(),
        source: launch.source,
        print: launch.print,
        explicitCommonJs: launch.execArgv[0] === '--input-type=commonjs',
      })
    : runNodeEntry({
        vfs: syncMirror(),
        entryPath: requiredEntryPath(entryPath),
        cwd: proc.cwd(),
        bin,
      });

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
// correct argv/cwd/stdin + fork-IPC `send`. No swap, so every entry path reads the
// same runtime-owned flowing stdin and its loud unsupported pull/raw surfaces.
// The else-branch (.bin/execSync) already has Buffer + nextTick from pre-entry;
// a server-capable launch additionally registers net builtins.
if (nodeServe) {
  registerNetBuiltins();
  await runNodeProgramLifecycle({
    runEntry,
    listPorts: () => listPorts(),
    onPortsChange: (cb) => onRegistryChange(cb),
    // A serve-capable foreground process may be a real long-lived supervisor
    // (nodemon) whose referenced watcher/timer handles are its Node lifetime.
    // The owner signal/peer boundary remains the physical stop authority.
    awaitDrain: () => awaitDrain({ capMs: Number.POSITIVE_INFINITY }),
    releaseDrainOwnership: releaseNodeEvalDrainOwnership,
    servePreview: (port) =>
      serveCrossRealmPreview(
        port,
        async (request) => dispatchToPort(port, request),
        previewScope === undefined ? {} : { scope: previewScope },
      ),
    postListening: (ports) => postNodeProcessListeningControl(proc, ports, previewScope),
    readExitCode: () => proc.exitCode,
    exit: (code) => proc.exit(code),
  });
} else {
  await runEntry();
  // Honor process.exitCode on a clean return (Node parity, ADR-0157 D4): the kernel
  // reaps a no-throw return as exit 0, so a `.bin`/execSync CLI that set a non-zero
  // process.exitCode must surface it (proc.exit throws RIFTY_PROCESS_EXIT → kernel
  // maps the code). exitCode 0 stays a clean exit 0.
  if (proc.exitCode) proc.exit(proc.exitCode);
}
