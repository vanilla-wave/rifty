// Physical owner spawn boundary: browser effect dependencies + the kernel
// worker spawn. Split out of workbench-browser-owner.ts (file-size ratchet;
// the spawn/effect boundary is the file's one non-transport responsibility).

import { NotImplementedError } from '@riftydev/io';
import {
  type SpawnWorkerSpec,
  type WorkerProcessHandle,
  globalProcessManager,
  isSabIpcSupported,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { wirePreviewBridge } from '../glue/preview-port-wiring.ts';
import type {
  ServiceWorkerControlContainer,
  ServiceWorkerControlTimers,
} from './service-worker-control.ts';
import type { WorkbenchOwnerStartInput } from './workbench-owner-port.ts';

export interface BrowserOwnerDependencies {
  readonly spawnOwner: (input: WorkbenchOwnerStartInput) => WorkerProcessHandle;
  readonly serviceWorker: ServiceWorkerControlContainer;
  readonly timers: ServiceWorkerControlTimers;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly mountPreview: typeof wirePreviewBridge;
  readonly operationId: () => string;
}

export function browserDependencies(): BrowserOwnerDependencies {
  return {
    spawnOwner: spawnBrowserOwner,
    serviceWorker: navigator.serviceWorker,
    timers: {
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (timerId) => window.clearTimeout(timerId),
    },
    fetch: (url, init) => globalThis.fetch(url, init),
    mountPreview: wirePreviewBridge,
    operationId: createOperationId,
  };
}

function createOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Workbench owner operations require cryptographic randomUUID support');
  }
  return globalThis.crypto.randomUUID();
}

function spawnBrowserOwner(input: WorkbenchOwnerStartInput): WorkerProcessHandle {
  if (!isSabIpcSupported()) {
    throw new NotImplementedError(
      'workbench.open',
      'requires SAB IPC and a cross-origin-isolated browser tab',
    );
  }
  setKernelWorkerUrl(input.deployment.workers.kernel);
  const handle = globalProcessManager.spawnWorker(
    'workbench-owner',
    workbenchOwnerSpawnSpec(input),
    1,
    { cwd: '/' },
  );
  if (handle.kind !== 'worker') {
    throw new NotImplementedError('workbench.owner.worker', `spawnWorker returned ${handle.kind}`);
  }
  return handle;
}

/** Deployment chooses the entry; owner/project identity never enters guest env. */
export function workbenchOwnerSpawnSpec(input: WorkbenchOwnerStartInput): SpawnWorkerSpec {
  return Object.freeze({
    entry: Object.freeze({ kind: 'url' as const, url: input.deployment.workers.owner }),
    argv: Object.freeze(['rifty', 'workbench-owner']),
    env: Object.freeze({}),
    cwd: '/',
    serve: false,
  });
}
