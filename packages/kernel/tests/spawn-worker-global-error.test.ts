/**
 * backlog/kernel/worker-global-error-to-stderr: a worker's uncaught GLOBAL
 * error (one that escapes worker-entry's top-level try/catch — thrown inside a
 * queueMicrotask / timer / unhandled EventEmitter 'error' re-throw like
 * EADDRINUSE) reaches the parent via the worker's `error` event. Before the fix
 * `onError` mapped it to exit 1 but DROPPED the message, so the child exited 1
 * with NO text on its stderr (loud exit, vanished diagnostic). After the fix the
 * message is forwarded to the child's stderr so `handle.stderr().on('data')`
 * sees it (and the terminal EADDRINUSE quick-fix can fire on the real string).
 */
import { describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../src/process-manager.ts';
import type { WorkerProcessHandle } from '../src/process-manager.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearWorkerFactoryForTests,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
  spawnKernelWorker,
} from '../src/spawn-worker.ts';
import { sealWorkerOutput } from '../src/worker-stdio-drain.ts';
import { attestedExitEvent } from './attested-exit.ts';

type Listener = (ev: MessageEvent) => void;

class FakeWorker implements WorkerLike {
  private readonly listeners = new Map<string, Set<Listener>>();
  readonly posted: unknown[] = [];
  terminated = false;
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string, ev: MessageEvent): void {
    for (const cb of [...(this.listeners.get(type) ?? [])]) cb(ev);
  }
}

/** Collect the bytes a handle's stderr stream emits, decoded to a string. */
function collectStderr(handle: WorkerProcessHandle): { text: () => string } {
  const decoder = new TextDecoder();
  let buf = '';
  handle.stderr().on('data', (chunk: unknown) => {
    if (chunk instanceof Uint8Array) buf += decoder.decode(chunk);
  });
  return { text: () => buf };
}

const flushWorkerExit = () =>
  new Promise<void>((r) => setTimeout(() => setTimeout(() => setTimeout(r, 0), 0), 0));

describe('spawnKernelWorker — uncaught global error reaches the child stderr', () => {
  function withFakeWorker<T>(fn: (worker: () => FakeWorker | undefined) => T): T {
    let made: FakeWorker | undefined;
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => {
      made = new FakeWorker();
      return made;
    });
    try {
      return fn(() => made);
    } finally {
      clearWorkerFactoryForTests();
      clearKernelDispatcher();
    }
  }

  it("forwards a worker 'error' event's message to the child stderr + exits 1", async () => {
    await withFakeWorker(async (worker) => {
      const pm = new ProcessManager();
      const handle = pm.spawnWorker('node', {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
        argv: ['rifty', '/tmp/x.js'],
        env: {},
        cwd: '/workspace',
      }) as WorkerProcessHandle;
      const stderr = collectStderr(handle);
      let exitCode: number | null = null;
      let exits = 0;
      handle.on('exit', (code: unknown) => {
        exits++;
        exitCode = typeof code === 'number' ? code : null;
      });

      // Drive the worker's uncaught async error — an unhandled EADDRINUSE
      // EventEmitter re-throw surfaces here as the global 'error' event.
      const preventDefault = vi.fn();
      const ev = {
        type: 'error',
        message: 'Uncaught Error: listen EADDRINUSE: address already in use :::3000',
        filename: 'server.js',
        lineno: 12,
        preventDefault,
      } as unknown as MessageEvent;
      worker()?.fire('error', ev);
      const duplicatePreventDefault = vi.fn();
      worker()?.fire('error', {
        type: 'error',
        message: 'Uncaught Error: duplicate worker error',
        preventDefault: duplicatePreventDefault,
      } as unknown as MessageEvent);
      await flushWorkerExit();

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(duplicatePreventDefault).toHaveBeenCalledOnce();
      expect(stderr.text()).toContain('EADDRINUSE');
      expect(stderr.text()).not.toContain('duplicate worker error');
      expect(exitCode).toBe(1);
      expect(exits).toBe(1);
    });
  });

  it('still owns an already-queued worker error after physical termination', () => {
    withFakeWorker((worker) => {
      const spawned = spawnKernelWorker(
        {
          entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
          argv: ['rifty', '/tmp/x.js'],
          env: {},
          cwd: '/workspace',
        },
        { pid: 200, ppid: 1 },
      );
      const uncaught = vi.fn();
      const exit = vi.fn();
      spawned.onUncaughtError(uncaught);
      spawned.onExit(exit);

      spawned.terminate();
      const preventDefault = vi.fn();
      worker()?.fire('error', {
        type: 'error',
        message: 'Uncaught Error: queued before termination',
        preventDefault,
      } as unknown as MessageEvent);

      expect(worker()?.terminated).toBe(true);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(uncaught).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
    });
  });

  it('forwards BEFORE exit so a consumer that mutes output on exit still sees it', async () => {
    // Models the owner-child-node-executor / bin-executor foreground gate: it
    // sets `outputClosed = true` SYNCHRONOUSLY in its `'exit'` handler and drops
    // any later stderr 'data'. The forwarded error must reach the consumer
    // BEFORE that gate closes, or the diagnostic is muted on the terminal (the
    // whole point of the forward — incl. the EADDRINUSE quick-fix string).
    await withFakeWorker(async (worker) => {
      const pm = new ProcessManager();
      const handle = pm.spawnWorker('node', {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
        argv: ['rifty', '/tmp/x.js'],
        env: {},
        cwd: '/workspace',
      }) as WorkerProcessHandle;

      const decoder = new TextDecoder();
      let outputClosed = false;
      let written = '';
      handle.stderr().on('data', (chunk: unknown) => {
        if (outputClosed) return; // the foreground gate
        if (chunk instanceof Uint8Array) written += decoder.decode(chunk);
      });
      handle.on('exit', () => {
        outputClosed = true;
      });

      const ev = {
        type: 'error',
        message: 'Uncaught Error: listen EADDRINUSE: address already in use :::3000',
        preventDefault: vi.fn(),
      } as unknown as MessageEvent;
      worker()?.fire('error', ev);
      await flushWorkerExit();

      expect(written).toContain('EADDRINUSE');
    });
  });

  it('does NOT write to stderr on a normal exit message (generic path unchanged)', async () => {
    await withFakeWorker(async (worker) => {
      const pm = new ProcessManager();
      const handle = pm.spawnWorker('node', {
        entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
        argv: ['rifty', '/tmp/x.js'],
        env: {},
        cwd: '/workspace',
      }) as WorkerProcessHandle;
      const stderr = collectStderr(handle);
      let exitCode: number | null = null;
      handle.on('exit', (code: unknown) => {
        exitCode = typeof code === 'number' ? code : null;
      });

      // A run-to-completion worker posts a plain exit message — no 'error'
      // event. The new forwarding must NOT inject any stderr here.
      const made = worker();
      if (made === undefined) throw new Error('expected fake Worker');
      const init = made.posted[0] as {
        spec: {
          outputState: import('../src/worker-stdio-drain.ts').WorkerOutputState;
        };
      };
      sealWorkerOutput(init.spec.outputState);
      worker()?.fire('message', attestedExitEvent(worker() as FakeWorker, 0));
      await flushWorkerExit();

      expect(stderr.text()).toBe('');
      expect(exitCode).toBe(0);
    });
  });
});
