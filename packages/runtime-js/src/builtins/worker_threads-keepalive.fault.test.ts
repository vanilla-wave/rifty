/**
 * ADR-0446 fault rows at the parent ↔ kernel Worker boundary: a live Worker
 * holds its parent's ADR-0152 keepalive, and every terminal path releases every
 * hold it took — peer death, a spawn the DOM Worker boundary refuses, a peer
 * death or failed start whose 'error' nobody listens to, and a constructor that
 * throws (which takes none). Only the absent DOM Worker and the browser's microtask exception
 * report are substituted; the real kernel ProcessManager allocates, wires and
 * retires, and the production realm error trap dispatches.
 */
import {
  KERNEL_PROCESS_SPEC_KEY,
  publishKernelEntryBootstrap,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeRefs, installUnhandledErrorTrap } from '../internal/event-loop-keepalive.ts';
import {
  closeKernelWorkerPeer,
  installKernelWorkerBoundary,
} from '../internal/kernel-worker-boundary.test-helper.ts';
import type { EventEmitter } from './events.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import * as nodeEntryUrl from './node-entry-url.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
import { NodeProcess, setProcessCwd } from './process.ts';
import { Worker, _resetFallbackWarnState } from './worker_threads.ts';
import '../module-loader/loader.ts';

type Coi = { crossOriginIsolated?: boolean };
type NodeEntryUrlContract = typeof nodeEntryUrl & {
  configureNodeEntryWorker(url: string | URL, runtimeEnv: Readonly<Record<string, string>>): void;
};
const configureNodeEntryWorker = (nodeEntryUrl as NodeEntryUrlContract).configureNodeEntryWorker;

const onceEvent = <T = unknown>(emitter: EventEmitter, event: string): Promise<T> =>
  new Promise<T>((resolve) => emitter.once(event, (...args: unknown[]) => resolve(args[0] as T)));

function enableKernelWorkers(): void {
  (globalThis as Coi).crossOriginIsolated = true;
  setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
  configureNodeEntryWorker('https://rifty.test/node-entry.js', {
    RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
  });
}

type RealmErrorListener = Parameters<
  NonNullable<Parameters<typeof installUnhandledErrorTrap>[0]>['addEventListener']
>[1];

/**
 * The browser's report of a throw escaping a queued microtask (absent under
 * Node): the realm `error` event reaches the production trap; an uncancelled
 * event is the realm's default report.
 */
function installRealmErrorReport(): { readonly reported: unknown[]; restore(): void } {
  const listeners: RealmErrorListener[] = [];
  installUnhandledErrorTrap({ addEventListener: (_type, listener) => listeners.push(listener) });
  const reported: unknown[] = [];
  const hostQueueMicrotask = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (callback) =>
    hostQueueMicrotask(() => {
      try {
        callback();
      } catch (error) {
        let cancelled = false;
        const event = {
          error,
          preventDefault: () => {
            cancelled = true;
          },
        };
        for (const listener of listeners) listener(event);
        if (!cancelled) reported.push(error);
      }
    });
  return {
    reported,
    restore: () => {
      globalThis.queueMicrotask = hostQueueMicrotask;
    },
  };
}

/** Worker ends through its own 'error' path: a kernel peer death and failed starts. */
const FAILURES: ReadonlyArray<{
  readonly label: string;
  readonly start: () => { worker: Worker; restore(): void };
}> = [
  {
    label: 'kernel peer death',
    start: () => {
      const restore = installKernelWorkerBoundary(closeKernelWorkerPeer);
      enableKernelWorkers();
      return { worker: new Worker('/workspace/w-peer-death.mjs'), restore };
    },
  },
  {
    label: 'kernel spawn refused by the DOM Worker boundary',
    start: () => {
      const restore = installKernelWorkerBoundary(() => {
        throw new Error('boundary refused the kernel Worker init');
      });
      enableKernelWorkers();
      return { worker: new Worker('/workspace/w-refused.mjs'), restore };
    },
  },
  {
    label: 'data: URL entry (NotImplementedError)',
    start: () => ({ worker: new Worker(new URL('data:text/javascript,1')), restore: () => {} }),
  },
  {
    label: 'same-realm load failure',
    start: () => ({ worker: new Worker('/workspace/w-missing.cjs'), restore: () => {} }),
  },
];

const settleWithin = (promise: Promise<unknown>, ms: number): Promise<unknown> =>
  Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);

async function withParentProcess<T>(run: () => Promise<T>): Promise<T> {
  const parent = new NodeProcess();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const previousActive = readActiveNodeProcessBootstrap();
  setActiveNodeProcessBootstrap(parent, true);
  Object.defineProperty(globalThis, 'process', {
    value: parent,
    configurable: true,
    writable: true,
  });
  try {
    return await run();
  } finally {
    setActiveNodeProcessBootstrap(
      previousActive?.process ?? null,
      previousActive?.federated ?? false,
    );
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, 'process');
    else Object.defineProperty(globalThis, 'process', descriptor);
  }
}

beforeEach(() => {
  _resetFallbackWarnState();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as Coi).crossOriginIsolated = false;
  publishKernelEntryBootstrap(null);
  Reflect.deleteProperty(globalThis, KERNEL_PROCESS_SPEC_KEY);
  nodeEntryUrl.resetNodeEntryWorkerUrl();
  setProcessCwd('/workspace');
  resetSyncMirror();
});

describe('worker_threads Worker keepalive holds (ADR-0446)', () => {
  it('holds the parent while its kernel peer lives and releases every hold at peer death', async () => {
    const restoreWorker = installKernelWorkerBoundary(closeKernelWorkerPeer);
    enableKernelWorkers();
    try {
      await withParentProcess(async () => {
        const baseline = activeRefs();
        const worker = new Worker('/workspace/w-peer-death.mjs');
        worker.on('message', () => {});
        const events: string[] = [];
        worker.on('error', () => events.push('error'));
        const exited = onceEvent<number>(worker, 'exit');
        const heldWhileAlive = activeRefs() > baseline;
        events.push(`exit:${await exited}`);

        expect({ heldWhileAlive, events, releasedAtExit: activeRefs() === baseline }).toEqual({
          heldWhileAlive: true,
          events: ['error', 'exit:1'],
          releasedAtExit: true,
        });
      });
    } finally {
      restoreWorker();
    }
  });

  it('releases the hold when the DOM Worker boundary refuses the spawn', async () => {
    const restoreWorker = installKernelWorkerBoundary(() => {
      throw new Error('boundary refused the kernel Worker init');
    });
    enableKernelWorkers();
    try {
      await withParentProcess(async () => {
        const baseline = activeRefs();
        const worker = new Worker('/workspace/w-refused.mjs');
        const heldWhileAlive = activeRefs() > baseline;
        const errors: unknown[] = [];
        worker.on('error', (error) => errors.push(error));
        const code = await onceEvent<number>(worker, 'exit');

        expect({
          heldWhileAlive,
          code,
          errors: errors.length,
          releasedAtExit: activeRefs() === baseline,
        }).toEqual({ heldWhileAlive: true, code: 1, errors: 1, releasedAtExit: true });
      });
    } finally {
      restoreWorker();
    }
  });

  it('takes no hold when the constructor throws, and holds a valid Worker from construction', async () => {
    const restoreWorker = installKernelWorkerBoundary(closeKernelWorkerPeer);
    enableKernelWorkers();
    try {
      await withParentProcess(async () => {
        const baseline = activeRefs();
        expect(() => new Worker('not-a-relative-path.mjs')).toThrow(
          expect.objectContaining({ code: 'ERR_WORKER_PATH' }),
        );
        expect(() => new Worker(new URL('file:///workspace/w.mjs'), { eval: true })).toThrow(
          expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' }),
        );
        const afterThrows = activeRefs() - baseline;
        const worker = new Worker('/workspace/w-valid.mjs');
        worker.on('error', () => {});
        const afterConstruct = activeRefs() - baseline;
        await onceEvent(worker, 'exit');

        expect({ afterThrows, heldAfterConstruct: afterConstruct > 0 }).toEqual({
          afterThrows: 0,
          heldAfterConstruct: true,
        });
      });
    } finally {
      restoreWorker();
    }
  });

  // Node v24.16.0 (evidence §Final+GREEN reception, r2): 'error' first; unhandled, it
  // is the owner's uncaught exception. Node's 'exit' 1 placement races it; these
  // rows pin Node's most frequent order: after the handling's microtasks when
  // listened, between the uncaught exception and its microtasks otherwise, and
  // none once that exception ended the owner.
  for (const { label, start } of FAILURES) {
    it(`${label}: an unlistened 'error' is the owner's uncaught exception, then 'exit' 1 releases every hold`, async () => {
      const report = installRealmErrorReport();
      let restoreStart = () => {};
      try {
        await withParentProcess(async () => {
          const events: string[] = [];
          process.on('uncaughtException', () => {
            events.push('uncaught');
            queueMicrotask(() => events.push('micro'));
          });
          const baseline = activeRefs();
          const started = start();
          restoreStart = started.restore;
          started.worker.on('message', () => {});
          const exited = new Promise((resolve) =>
            started.worker.on('exit', (code) => resolve(events.push(`exit:${code}`))),
          );
          await settleWithin(exited, 500);
          await Promise.resolve();

          expect({
            events,
            reported: report.reported.length,
            releasedAtExit: activeRefs() === baseline,
          }).toEqual({
            events: ['uncaught', 'exit:1', 'micro'],
            reported: 0,
            releasedAtExit: true,
          });
        });
      } finally {
        restoreStart();
        report.restore();
      }
    });

    it(`${label}: an unlistened 'error' that ends the owner leaves no Worker 'exit'`, async () => {
      const report = installRealmErrorReport();
      let restoreStart = () => {};
      try {
        await withParentProcess(async () => {
          const events: string[] = [];
          process.on('exit', (code: number) => events.push(`owner-exit:${code}`));
          const started = start();
          restoreStart = started.restore;
          started.worker.on('exit', (code) => events.push(`exit:${code}`));
          await new Promise((resolve) => setTimeout(resolve, 100));

          expect({ events, reported: report.reported.length }).toEqual({
            events: ['owner-exit:1'],
            reported: 1,
          });
          await started.worker.terminate();
        });
      } finally {
        restoreStart();
        report.restore();
      }
    });

    it(`${label}: a listened 'error' runs its microtasks before 'exit' 1`, async () => {
      let restoreStart = () => {};
      try {
        await withParentProcess(async () => {
          const events: string[] = [];
          const started = start();
          restoreStart = started.restore;
          started.worker.on('error', () => {
            events.push('error');
            queueMicrotask(() => events.push('micro'));
          });
          await new Promise((resolve) =>
            started.worker.on('exit', (code) => resolve(events.push(`exit:${code}`))),
          );

          expect(events).toEqual(['error', 'micro', 'exit:1']);
        });
      } finally {
        restoreStart();
      }
    });
  }
});
