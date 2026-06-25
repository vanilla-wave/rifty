/// <reference lib="webworker" />
/**
 * Supervised dev-server child entry (ADR-0150 P6b) — a kind:'url' worker the
 * OWNER spawns (serve:true) to run the dev server out of the owner thread. It
 * reads+writes the owner store over fs.* sync-RPC (RIFTY_REMOTE_FS=1, like
 * node-entry-bootstrap), owns listen() + serveCrossRealmPreview, and talks to
 * the owner over fork-IPC (rifty:dev-ready/error/snapshot from here; rifty:dev-file-changed in).
 *
 * NOT here: initBackend()/OPFS (child reads via RPC — single-writer is the owner);
 * the pty server / shell / owner serve-bridges (those stay on the owner).
 * Env is read from readKernelProcessSpec() (the installProcessGlobals clobber-safe
 * source), never globalThis.process.env.
 */
import {
  getKernelDispatcher,
  readKernelProcessSpec,
  readKernelSyncApi,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import {
  installConsole,
  installRemoteSyncFs,
  installRuntimeJsFsHandlers,
} from '@riftydev/runtime-js';
import { setNodeEntryWorkerUrl } from '@riftydev/runtime-js/builtins/node-entry-url';
import { setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { isDevServerOwnerMessage } from '../glue/dev-server-ipc.ts';
import { bootDevServer } from './dev-server-boot.ts';
import { resolveDevServerChildConfig } from './dev-server-child-config.ts';
import type { DevServerHandle } from './dev-server-controller.ts';
import { type KernelIpc, installRuntimeGlobals } from './worker-runtime-globals.ts';

async function bootstrapDevServerChild(): Promise<void> {
  registerNetBuiltins();
  registerSqliteBuiltin();

  const env = { ...(readKernelProcessSpec()?.env ?? globalThis.process.env) };
  const kernelIpc: KernelIpc = installRuntimeGlobals();
  globalThis.process.env = env;

  const kernelWorkerUrl = env.RIFTY_KERNEL_WORKER_URL;
  const nodeEntryWorkerUrl = env.RIFTY_NODE_ENTRY_WORKER_URL;
  if (!kernelWorkerUrl || !nodeEntryWorkerUrl) {
    throw new Error(
      'dev-server-child: missing RIFTY_KERNEL_WORKER_URL / RIFTY_NODE_ENTRY_WORKER_URL — cannot spawn worker_threads children',
    );
  }
  setKernelWorkerUrl(kernelWorkerUrl);
  setNodeEntryWorkerUrl(nodeEntryWorkerUrl);

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
  const remoteFs = installRemoteSyncFs(syncApi.call);
  // The dev-server child SPAWNS nested workers — Rolldown's WASI pthread pool
  // (`@rolldown/binding-wasm32-wasi`, RIFTY_REMOTE_FS=1) — whose `fs.*` sync-RPC
  // calls land on THIS realm's dispatcher. The child has no OPFS of its own
  // (single-writer is the owner), so register the fs handlers backed by our own
  // remote view: the child becomes a fs RELAY that forwards a nested worker's
  // `fs.statOrNull`/reads to the owner store. Without this the Rolldown pthread
  // crashed with "SyncRpcDispatcher: no handler for 'fs.statOrNull'" and Vite
  // hung serving the first request.
  installRuntimeJsFsHandlers(getKernelDispatcher(), () => remoteFs);

  const c = resolveDevServerChildConfig(env);
  setProcessCwd(c.root);

  const send = (message: unknown): void => {
    kernelIpc.send?.(message);
  };

  let handle: DevServerHandle | null = null;
  let previewHandle: { readonly port: number; stop(): Promise<void> } | null = null;
  kernelIpc.onMessage?.((message) => {
    if (isDevServerOwnerMessage(message) && handle) handle.onFileChanged?.(message.path);
    void previewHandle;
  });

  try {
    if (env.RIFTY_VITE_CHILD_MODE === 'build') {
      const { bootBuild } = await import('./build-boot.ts');
      await bootBuild({ root: c.root, log: (chunk) => proc.stdout.write(chunk) });
      send({ type: 'rifty:dev-snapshot' });
      return;
    }
    if (env.RIFTY_VITE_CHILD_MODE === 'preview') {
      const { bootPreview } = await import('./build-boot.ts');
      previewHandle = await bootPreview({
        root: c.root,
        port: c.port,
        log: (chunk) => proc.stdout.write(chunk),
      });
      send({ type: 'rifty:preview-ready', port: previewHandle.port });
      return;
    }
    handle = await bootDevServer({
      cfg: c.cfg,
      port: c.port,
      root: c.root,
      spec: c.spec,
      slug: c.slug,
      fromScratch: c.fromScratch,
      publishSnapshot: () => send({ type: 'rifty:dev-snapshot' }),
      log: (chunk) => proc.stdout.write(chunk),
    });
    send({ type: 'rifty:dev-ready', port: handle.port });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    proc.stderr.write(`${err instanceof Error && err.stack ? err.stack : message}\n`);
    send({ type: 'rifty:dev-error', message });
    throw err;
  }
}

// Real worker only: the kernel publishes the process spec per spawn; under vitest
// it is null, so importing this module never boots (and never triggers the heavy
// register/net/vite paths inside the fn).
if (readKernelProcessSpec() !== null) {
  await bootstrapDevServerChild();
}
