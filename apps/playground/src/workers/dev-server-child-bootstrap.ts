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
import { readKernelProcessSpec, readKernelSyncApi } from '@riftydev/kernel';
import { registerNetBuiltins } from '@riftydev/net/register-builtins';
import { registerSqliteBuiltin } from '@riftydev/net/sqlite/register-builtins';
import { installConsole, installRemoteSyncFs } from '@riftydev/runtime-js';
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
  installRemoteSyncFs(syncApi.call);

  const c = resolveDevServerChildConfig(env);
  setProcessCwd(c.root);

  const send = (message: unknown): void => {
    kernelIpc.send?.(message);
  };

  let handle: DevServerHandle | null = null;
  kernelIpc.onMessage?.((message) => {
    if (isDevServerOwnerMessage(message) && handle) handle.onFileChanged?.(message.path);
  });

  try {
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
    send({ type: 'rifty:dev-error', message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// Real worker only: the kernel publishes the process spec per spawn; under vitest
// it is null, so importing this module never boots (and never triggers the heavy
// register/net/vite paths inside the fn).
if (readKernelProcessSpec() !== null) {
  await bootstrapDevServerChild();
}
