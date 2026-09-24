/**
 * ADR-0446 fault rows at the parent ↔ kernel Worker boundary: a live Worker
 * holds its parent's ADR-0152 keepalive, and every terminal path releases every
 * hold it took — peer death, a spawn the DOM Worker boundary refuses, and a
 * constructor that throws (which takes none). Only the absent DOM Worker is
 * substituted; the real kernel ProcessManager allocates, wires and retires.
 */
import {
  KERNEL_PROCESS_SPEC_KEY,
  publishKernelEntryBootstrap,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeRefs } from '../internal/event-loop-keepalive.ts';
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
});
