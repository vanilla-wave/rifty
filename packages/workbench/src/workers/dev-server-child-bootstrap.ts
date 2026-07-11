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
import { getKernelDispatcher, readKernelProcessSpec, readKernelSyncApi } from '@riftydev/kernel';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import {
  installConsole,
  installRemoteSyncFs,
  installRuntimeJsFsHandlers,
} from '@riftydev/runtime-js';
import { setProcessCwd } from '@riftydev/runtime-js/builtins/process';
import { isDevServerOwnerMessage } from '../glue/dev-server-ipc.ts';
import { installSqliteWasmSyncProvider } from '../glue/sqlite-wasm-provider.ts';
import { bootDevServer } from './dev-server-boot.ts';
import { resolveDevServerChildConfig } from './dev-server-child-config.ts';
import type { DevServerHandle } from './dev-server-controller.ts';
import { configureEsbuildWasmUrl } from './esbuild-wasi-transform.ts';
import { installChildRuntimeConfig } from './worker-config.ts';
import {
  type KernelIpc,
  installBundleLocalBuffer,
  installRuntimeGlobals,
} from './worker-runtime-globals.ts';

export async function bootstrapDevServerChild(): Promise<void> {
  const env = { ...(readKernelProcessSpec()?.env ?? globalThis.process.env) };
  const assets = installChildRuntimeConfig(env);
  registerNetBuiltins();
  registerSqliteBuiltin();
  // node:sqlite self-initializes at first require (sync wasm provider) — no
  // preset flag, no eager bring-up.
  installSqliteWasmSyncProvider(assets.sqliteWasmUrl);
  configureEsbuildWasmUrl(assets.esbuildWasmUrl);

  // Realign globalThis.Buffer with THIS bundle's `require('buffer')` (the one
  // express builds chunks with) — else etag reads the kernel-worker-entry bundle's
  // copy installed by the pre-entry hook and `Buffer.isBuffer` is false in a
  // production build (res.json → etag throw). See installBundleLocalBuffer.
  installBundleLocalBuffer();

  const kernelIpc: KernelIpc = installRuntimeGlobals();
  globalThis.process.env = env;

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
        previewScope: c.previewScope,
        log: (chunk) => proc.stdout.write(chunk),
      });
      send({
        type: 'rifty:preview-ready',
        port: previewHandle.port,
        ...(c.previewScope === undefined ? {} : { previewScope: c.previewScope }),
      });
      return;
    }
    handle = await bootDevServer({
      cfg: c.cfg,
      port: c.port,
      root: c.root,
      spec: c.spec,
      slug: c.slug,
      fromScratch: c.fromScratch,
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
// register/net/vite paths inside the fn).
if (readKernelProcessSpec() !== null) {
  await bootstrapDevServerChild();
}
