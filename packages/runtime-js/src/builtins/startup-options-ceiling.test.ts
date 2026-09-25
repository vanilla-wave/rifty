/**
 * ADR-0449 named gaps: startup options and Worker stdio rifty does not carry
 * throw `NotImplementedError` synchronously, before any thread id, hold or
 * child is allocated — never a silently dropped flag or an ignored option.
 * Node accepts these calls (evidence §Unsupported flags), so this is a rifty
 * ceiling contract, not a parity case.
 */
import { globalProcessManager, setKernelWorkerUrl } from '@riftydev/kernel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fork } from './child_process.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import * as nodeEntryUrl from './node-entry-url.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
import { NodeProcess, setProcessCwd } from './process.ts';
import {
  Worker,
  _resetFallbackWarnState,
  _resetThreadIdCounterForTests,
} from './worker_threads.ts';
import '../module-loader/loader.ts';

type Coi = { crossOriginIsolated?: boolean };
type NodeEntryUrlContract = typeof nodeEntryUrl & {
  configureNodeEntryWorker(url: string | URL, runtimeEnv: Readonly<Record<string, string>>): void;
};
const configureNodeEntryWorker = (nodeEntryUrl as NodeEntryUrlContract).configureNodeEntryWorker;

function namedGap(feature: string, mentions?: string): unknown {
  return expect.objectContaining({
    name: 'NotImplementedError',
    feature,
    // The message names the offending token, quoted.
    ...(mentions === undefined ? {} : { message: expect.stringContaining(`'${mentions}'`) }),
  });
}

/** The constructor's throw, or `undefined` after settling a Worker it wrongly started. */
async function workerError(construct: () => Worker): Promise<unknown> {
  let worker: Worker;
  try {
    worker = construct();
  } catch (error) {
    return error;
  }
  worker.on('error', () => {});
  await new Promise((resolve) => worker.once('exit', resolve));
  return undefined;
}

/** fork's throw, or `undefined` after settling a child it wrongly spawned. */
async function forkError(start: () => ReturnType<typeof fork>): Promise<unknown> {
  let child: ReturnType<typeof fork>;
  try {
    child = start();
  } catch (error) {
    return error;
  }
  child.on('error', () => {});
  await new Promise((resolve) => child.once('exit', resolve));
  return undefined;
}

function kernelCapableRealm() {
  (globalThis as Coi).crossOriginIsolated = true;
  setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
  configureNodeEntryWorker('https://rifty.test/node-entry.js', {
    RIFTY_KERNEL_WORKER_URL: 'https://rifty.test/kernel-worker.js',
  });
  // The Node host has no DOM Worker: an allocation that got this far fails loudly.
  return vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation(() => {
    throw new Error('test: kernel Worker allocated');
  });
}

async function withParentProcess<T>(run: (parent: NodeProcess) => Promise<T>): Promise<T> {
  const parent = new NodeProcess();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const previousActive = readActiveNodeProcessBootstrap();
  setActiveNodeProcessBootstrap(parent, false);
  Object.defineProperty(globalThis, 'process', {
    value: parent,
    configurable: true,
    writable: true,
  });
  try {
    return await run(parent);
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
  _resetThreadIdCounterForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setProcessCwd('/');
  writeFileSync('/worker.cjs', ';');
  writeFileSync('/child.cjs', ';');
  writeFileSync('/pre.cjs', ';');
});

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as Coi).crossOriginIsolated = false;
  nodeEntryUrl.resetNodeEntryWorkerUrl();
  resetSyncMirror();
});

describe('worker_threads.Worker startup-option and stdio ceilings (ADR-0449)', () => {
  it.each([
    [['--no-warnings'], '--no-warnings'],
    [['--require', './pre.cjs', '--import', './hook.mjs'], '--import'],
    [['--experimental-vm-modules'], '--experimental-vm-modules'],
    [['-e', '42'], '-e'],
    [[42], '42'],
  ])('names unsupported execArgv %j before allocating a thread', async (execArgv, token) => {
    const spawnWorker = kernelCapableRealm();
    const thrown = await withParentProcess(() =>
      workerError(() => new Worker('/worker.cjs', { execArgv: execArgv as string[] })),
    );
    expect(thrown).toEqual(namedGap('worker_threads.Worker.execArgv', token));
    expect(spawnWorker).not.toHaveBeenCalled();
  });

  it('names `stdin: true` (the parent-to-worker stdin stream is not carried)', async () => {
    const spawnWorker = kernelCapableRealm();
    const thrown = await withParentProcess(() =>
      workerError(() => new Worker('/worker.cjs', { stdin: true } as never)),
    );
    expect(thrown).toEqual(namedGap('worker_threads.Worker.stdin'));
    expect(spawnWorker).not.toHaveBeenCalled();
  });

  it('names captured stdio and startup options on the same-realm fallback', async () => {
    await withParentProcess(async () => {
      for (const options of [{ stdout: true }, { stderr: true }]) {
        expect(await workerError(() => new Worker('/worker.cjs', options as never))).toEqual(
          namedGap('worker_threads.Worker.stdio.same-realm'),
        );
      }
      expect(
        await workerError(
          () => new Worker('/worker.cjs', { execArgv: ['--require', './pre.cjs'] }),
        ),
      ).toEqual(namedGap('worker_threads.Worker.execArgv.same-realm'));
    });
  });

  it('names reading a same-realm Worker stream (its output shares the parent streams)', async () => {
    await withParentProcess(async () => {
      const worker = new Worker('/worker.cjs');
      const exited = new Promise((resolve) => worker.once('exit', resolve));
      const read = (key: 'stdout' | 'stderr'): unknown => {
        try {
          return (worker as unknown as Record<string, unknown>)[key];
        } catch (error) {
          return error;
        }
      };
      expect(read('stdout')).toEqual(namedGap('worker_threads.Worker.stdio.same-realm'));
      expect(read('stderr')).toEqual(namedGap('worker_threads.Worker.stdio.same-realm'));
      await exited;
    });
  });
});

describe('child_process.fork startup-option ceilings (ADR-0449)', () => {
  it.each([
    [['--no-warnings'], '--no-warnings'],
    [['--import', './hook.mjs'], '--import'],
    [['--require'], '--require'],
    [['--conditions='], '--conditions='],
    [[42], '42'],
    ['--require', '--require'],
  ])('names unsupported or malformed execArgv %j before spawning', async (execArgv, token) => {
    const spawn = vi.spyOn(globalProcessManager, 'spawn');
    const thrown = await withParentProcess(() =>
      forkError(() => fork('/child.cjs', [], { execArgv } as never)),
    );
    expect(thrown).toEqual(namedGap('child_process.fork.execArgv', token));
    expect(spawn).not.toHaveBeenCalled();
  });

  it('names an inherited parent flag it cannot carry', async () => {
    const spawn = vi.spyOn(globalProcessManager, 'spawn');
    const thrown = await withParentProcess((parent) => {
      parent.execArgv.push('--no-deprecation');
      return forkError(() => fork('/child.cjs'));
    });
    expect(thrown).toEqual(namedGap('child_process.fork.execArgv', '--no-deprecation'));
    expect(spawn).not.toHaveBeenCalled();
  });

  it('names startup options on the same-realm fallback instead of dropping them', async () => {
    const spawn = vi.spyOn(globalProcessManager, 'spawn');
    const thrown = await withParentProcess(() =>
      forkError(() => fork('/child.cjs', [], { execArgv: ['--require', './pre.cjs'] } as never)),
    );
    expect(thrown).toEqual(namedGap('child_process.fork.execArgv.same-realm'));
    expect(spawn).not.toHaveBeenCalled();
  });
});
