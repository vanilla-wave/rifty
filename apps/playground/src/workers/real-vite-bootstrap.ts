/// <reference lib="webworker" />

import { globalProcessManager, readKernelProcessSpec } from '@riftydev/kernel';
import { syncMirror } from '@riftydev/vfs';
import { waitForActiveProjectReady } from '@riftydev/workbench/owner-worker';
import { resolveProjectSpec } from '../templates/registry.ts';
import { createTsLspOwnerRelay } from './ts-lsp-owner-relay.ts';
import tsLanguageServiceWorkerUrl from './ts-lsp-worker-entry.ts?worker&url';

interface OwnerProcess {
  readonly env?: Record<string, string | undefined>;
  on?(event: 'message', listener: (message: unknown) => void): unknown;
  send?(message: unknown): unknown;
  readonly stdout?: { write?(line: string): unknown };
}

const ownerProcess = globalThis.process as unknown as OwnerProcess;
const env = readKernelProcessSpec()?.env ?? ownerProcess.env ?? {};
const root = env.RIFTY_RFV_ROOT ?? '/scratch';

createTsLspOwnerRelay({
  workerUrl: tsLanguageServiceWorkerUrl,
  root,
  ownerBridgeKey: env.RIFTY_RFV_PORT ?? 'owner:default',
  initialTemplateId: env.RIFTY_RFV_TEMPLATE ?? 'vite',
  resolveProjectSpec,
  waitForActiveProjectReady,
  existsSync: (path) => syncMirror().existsSync(path),
  spawnWorker: (name, spec, ppid) => {
    const handle = globalProcessManager.spawnWorker(name, spec, ppid);
    if (handle.kind !== 'worker') {
      throw new Error(`ts-lsp owner relay: expected worker handle, got ${handle.kind}`);
    }
    return handle;
  },
  onOwnerMessage: (listener) => {
    ownerProcess.on?.('message', listener);
    return undefined;
  },
  sendOwnerMessage: (message) => {
    ownerProcess.send?.(message);
  },
  log: (line) => {
    ownerProcess.stdout?.write?.(line);
  },
});
