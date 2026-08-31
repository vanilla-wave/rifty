/// <reference lib="webworker" />
/**
 * Supervised dev-server child entry (ADR-0150 P6b) — a kind:'url' worker the
 * OWNER spawns (serve:true) to run the dev server out of the owner thread. It
 * reads+writes the owner store over fs.* sync-RPC (RIFTY_REMOTE_FS=1, like
 * node-entry-bootstrap), owns listen() + serveCrossRealmPreview, and talks to
 * the owner over fork-IPC (rifty:dev-ready/error/snapshot/ports from here).
 *
 * NOT here: initBackend()/OPFS (child reads via RPC — single-writer is the owner);
 * the pty server / shell / owner serve-bridges (those stay on the owner).
 * Env is read from readKernelProcessSpec() (the installProcessGlobals clobber-safe
 * source), never globalThis.process.env.
 */
import { getKernelDispatcher, readKernelProcessSpec, readKernelSyncApi } from '@riftydev/kernel';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { installConsole, installRemoteSyncFs } from '@riftydev/runtime-js';
import {
  applyNodeProcessTerminalBootstrap,
  setProcessCwd,
} from '@riftydev/runtime-js/builtins/process';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { installOwnerSyncRuntimeHandlers } from '../glue/owner-sync-runtime-handlers.ts';
import { installSqliteWasmSyncProvider } from '../glue/sqlite-wasm-provider.ts';
import { bootDevServer } from './dev-server-boot.ts';
import { readDevServerChildConfig } from './dev-server-child-config.ts';
import type { DevServerHandle } from './dev-server-controller.ts';
import { prepareNodeEntryRuntime } from './node-entry-runtime-preparation.ts';
import { installNodeWorkerRuntimeConfig } from './node-worker-runtime-config.ts';
import { ProjectTerminalFsSync } from './project-terminal-namespace.ts';
import {
  type KernelIpc,
  installBundleLocalBuffer,
  installRuntimeGlobals,
} from './worker-runtime-globals.ts';

async function bootstrapDevServerChild(): Promise<void> {
  registerNetBuiltins();
  registerSqliteBuiltin();

  // Realign globalThis.Buffer with THIS bundle's `require('buffer')` (the one
  // express builds chunks with) — else etag reads the kernel-worker-entry bundle's
  // copy installed by the pre-entry hook and `Buffer.isBuffer` is false in a
  // production build (res.json → etag throw). See installBundleLocalBuffer.
  installBundleLocalBuffer();

  const c = readDevServerChildConfig();
  const env = { ...(readKernelProcessSpec()?.env ?? globalThis.process.env) };
  const kernelIpc: KernelIpc = installRuntimeGlobals();
  applyNodeProcessTerminalBootstrap(globalThis.process, c.terminal);
  globalThis.process.env = env;

  installNodeWorkerRuntimeConfig(c.nodeWorkerRuntime);
  // node:sqlite self-initializes at first require using the inherited asset.
  installSqliteWasmSyncProvider(c.nodeWorkerRuntime.sqliteWasmUrl);

  const proc = globalThis.process;
  installConsole({
    stdout: (chunk) => proc.stdout.write(chunk),
    stderr: (chunk) => proc.stderr.write(chunk),
  });

  const syncApi = readKernelSyncApi();
  if (syncApi === null) {
    throw new Error(
      'dev-server-child: no kernel sync call published — cannot reach the owner store',
    );
  }
  const ownerRemoteFs = installRemoteSyncFs(syncApi.call, syncApi.callBinary);
  const remoteFs =
    c.remoteFsRoot === undefined
      ? ownerRemoteFs
      : new ProjectTerminalFsSync(ownerRemoteFs, c.remoteFsRoot);
  setSyncMirror(remoteFs);
  await prepareNodeEntryRuntime({
    bin: false,
    root: c.cfg.root,
    args: [],
    entryPath: c.cfg.entryPath,
    runtimeBindings: c.runtimeBindings ?? [],
    fs: remoteFs,
  });
  // A node-server child may spawn nested workers whose `fs.*` sync-RPC calls
  // land on THIS realm's dispatcher. The child has no OPFS of its own
  // (single-writer is the owner), so register the fs handlers backed by our own
  // remote view: the child becomes a fs RELAY that forwards a nested worker's
  // `fs.statOrNull`/reads to the owner store.
  installOwnerSyncRuntimeHandlers(getKernelDispatcher(), () => remoteFs);

  setProcessCwd(c.cfg.root);

  const send = (message: unknown): void => {
    kernelIpc.send?.(message);
  };

  try {
    const handle: DevServerHandle = await bootDevServer({
      cfg: c.cfg,
      previewScope: c.previewScope,
      publishSnapshot: () => send({ type: 'rifty:dev-snapshot' }),
      log: (chunk) => proc.stdout.write(chunk),
    });
    send({
      type: 'rifty:dev-ready',
      port: handle.port,
      ...(c.previewScope === undefined ? {} : { previewScope: c.previewScope }),
    });
    // Post-ready port tracking:
    // the entry may `server.close()` / re-listen — repost the FULL set on every
    // net-registry change so the owner's pill follows reality. The boot port's
    // bridge is owned by the stop handle (no-op teardown seeded); a NEW port gets
    // its own cross-realm bridge here.
    const { onRegistryChange, listPorts, serveCrossRealmPreview, dispatchToPort } = await import(
      '@riftydev/net'
    );
    const { watchServedPorts } = await import('./port-watch.ts');
    watchServedPorts({
      listPorts,
      subscribe: (cb) => onRegistryChange(cb),
      servePreview: (port) =>
        serveCrossRealmPreview(
          port,
          async (request) => dispatchToPort(port, request),
          c.previewScope === undefined ? {} : { scope: c.previewScope },
        ),
      post: (ports) =>
        send({
          type: 'rifty:dev-ports',
          ports,
          ...(c.previewScope === undefined ? {} : { previewScope: c.previewScope }),
        }),
      served: new Map([[handle.port, () => {}]]),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    proc.stderr.write(`${err instanceof Error && err.stack ? err.stack : message}\n`);
    send({ type: 'rifty:dev-error', message });
    throw err;
  }
}

// Real worker only: the kernel publishes the process spec per spawn; under vitest
// it is null, so importing this module never boots (and never triggers the heavy
// register/net paths inside the fn).
if (readKernelProcessSpec() !== null) {
  await bootstrapDevServerChild();
}
