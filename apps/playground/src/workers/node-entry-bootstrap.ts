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
import { dispatchToPort, listPorts, onRegistryChange, serveCrossRealmPreview } from '@riftydev/net';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { awaitDrain, installConsole, installRemoteSyncFs } from '@riftydev/runtime-js';
import { runNodeEntry } from '@riftydev/runtime-js/builtins/node-entry';
import { syncMirror } from '@riftydev/vfs';
import { installSqliteWasmSyncProvider } from '../glue/sqlite-wasm-provider.ts';
import { runNodeProgramLifecycle } from './node-program-lifecycle.ts';
import { installLoudStdin } from './node-stdin-guard.ts';
import {
  type ViteDevServerWithModuleGraph,
  invalidateViteModule,
} from './real-vite-invalidation.ts';
import { type ViteCliMode, type ViteCliPrepareOptions, prepareViteCli } from './vite-cli-prep.ts';
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
  installRemoteSyncFs(syncApi.call);
}

declare global {
  // Set by the generated Vite CLI config wrapper's configureServer hook.
  // eslint-disable-next-line no-var
  var __riftyActiveViteServer: ViteDevServerWithModuleGraph | undefined;
}

interface ViteFileChangeMessage {
  readonly type: 'rifty:vite-file-change';
  readonly path: string;
}

function isViteFileChangeMessage(message: unknown): message is ViteFileChangeMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as { readonly type?: unknown; readonly path?: unknown };
  return candidate.type === 'rifty:vite-file-change' && typeof candidate.path === 'string';
}

function installViteFileChangeBridge(): void {
  proc.on?.('message', (message: unknown) => {
    if (!isViteFileChangeMessage(message)) return;
    const server = globalThis.__riftyActiveViteServer;
    if (server) invalidateViteModule(server, message.path);
  });
}

function viteCliModeFromEnv(value: string | undefined): ViteCliMode | null {
  return value === 'dev' || value === 'build' || value === 'preview' || value === 'run'
    ? value
    : null;
}

function parsePort(value: string | undefined): number | null {
  if (value === undefined) return null;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

function viteCliPrepareOptionsFromEnv(
  env: Record<string, string | undefined>,
): ViteCliPrepareOptions {
  const port = parsePort(env.RIFTY_VITE_CLI_PORT);
  const userConfigPath = env.RIFTY_VITE_CLI_USER_CONFIG;
  return {
    ...(port === null
      ? {}
      : {
          hmr: {
            enabled: env.RIFTY_VITE_CLI_HMR === '1',
            port,
          },
        }),
    ...(userConfigPath ? { userConfigPath } : {}),
  };
}

const viteCliMode = viteCliModeFromEnv(proc.env.RIFTY_VITE_CLI_MODE);
if (viteCliMode !== null) {
  await prepareViteCli(proc.cwd(), viteCliMode, viteCliPrepareOptionsFromEnv(proc.env));
  if (viteCliMode === 'dev') installViteFileChangeBridge();
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
