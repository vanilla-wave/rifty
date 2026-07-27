/**
 * ADR-0045 — Worker-process IPC: parent↔child `MessagePort` pair with
 * `send` / `disconnect` / `'message'` / `'disconnect'` surface on the
 * Worker-backed {@link WorkerProcessHandle}.
 *
 * Before ADR-0045 this file was a negative-type guard: it asserted that
 * the Worker-backed handle did NOT carry `send`, with an `@ts-expect-error`
 * that would flip the test on the day fork-IPC landed. That day is today.
 *
 * Today's invariants:
 *   - `WorkerProcessHandle.send` is a regular method (no `@ts-expect-error`).
 *   - `WorkerProcessHandle.disconnect` exists.
 *   - The handle emits `'disconnect'` exactly once when the IPC channel
 *     tears down (explicit disconnect, kill, or natural worker exit).
 *
 * Mirror conformance lives in `tests/conformance/builtins/fork-ipc-worker.test.ts`
 * (skipped outside SAB-capable runtimes). These kernel-level tests use the
 * stub-Worker factory so they can run in plain Vitest.
 */
import { once } from '@riftydev/io';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessManager } from '../src/process-manager.ts';
import { clearKernelWorkerUrl, setKernelWorkerUrl } from '../src/spawn-worker.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearWorkerFactoryForTests,
  setWorkerFactoryForTests,
} from '../src/spawn-worker.ts';
import { sealWorkerOutput } from '../src/worker-stdio-drain.ts';
import { attestedExitEvent } from './attested-exit.ts';

type WorkerListener = (ev: MessageEvent) => void;

class FakeWorker implements WorkerLike {
  private readonly listeners = new Map<string, Set<WorkerListener>>();
  readonly posted: unknown[] = [];
  readonly terminate = vi.fn();
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  addEventListener(type: string, listener: WorkerListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }
  removeEventListener(type: string, listener: WorkerListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string, ev: MessageEvent): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const cb of [...set]) cb(ev);
  }
}

function sealWorkerOutputFor(worker: FakeWorker): void {
  const init = worker.posted[0] as {
    spec: {
      outputState: import('../src/worker-stdio-drain.ts').WorkerOutputState;
    };
  };
  sealWorkerOutput(init.spec.outputState);
}

describe('WorkerProcessHandle.send / disconnect (ADR-0045)', () => {
  let factoryWorker: FakeWorker | undefined;

  beforeEach(() => {
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => {
      factoryWorker = new FakeWorker();
      return factoryWorker;
    });
  });

  afterEach(() => {
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
    factoryWorker = undefined;
  });

  it('exposes send and disconnect on the worker-backed handle', () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    expect(handle.kind).toBe('worker');
    if (handle.kind === 'worker') {
      expect(typeof handle.send).toBe('function');
      expect(typeof handle.disconnect).toBe('function');
      // Fresh handle has no exit; sending should succeed (postMessage
      // on a MessagePort with no peer listener is still a valid op —
      // it just doesn't deliver until the child starts the port).
      expect(handle.send({ hi: 1 })).toBe(true);
    }
    handle.kill('SIGTERM');
  });

  it('posts an explicit stdin EOF frame after the final data chunk', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');
    const init = (factoryWorker as FakeWorker).posted[0] as {
      spec: { stdio: { stdin: MessagePort } };
    };
    const frames: unknown[] = [];
    init.spec.stdio.stdin.onmessage = (event) => frames.push(event.data);
    init.spec.stdio.stdin.start();

    try {
      handle.stdin().write(new Uint8Array([0x68, 0x69]));
      handle.stdin().end();

      await vi.waitFor(() =>
        expect(frames).toEqual([new Uint8Array([0x68, 0x69]), { kind: 'stdin:eof' }]),
      );
    } finally {
      handle.kill('SIGTERM');
    }
  });

  it('send returns false after explicit disconnect', () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');

    let disconnectEvents = 0;
    handle.on('disconnect', () => {
      disconnectEvents++;
    });

    expect(handle.send({ a: 1 })).toBe(true);
    handle.disconnect();
    // Idempotent — second disconnect is a no-op.
    handle.disconnect();
    expect(disconnectEvents).toBe(1);
    expect(handle.send({ a: 2 })).toBe(false);

    handle.kill('SIGTERM');
  });

  it('delivers a delayed tty control after logical IPC disconnect', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');
    const controlHandle = handle as typeof handle & {
      resize(cols: number, rows: number): boolean;
    };
    const init = (factoryWorker as FakeWorker).posted[0] as {
      spec: { stdio: { ipc: MessagePort } };
    };
    const frames: unknown[] = [];
    init.spec.stdio.ipc.onmessage = (event) => frames.push(event.data);
    init.spec.stdio.ipc.start();

    try {
      handle.disconnect();
      await vi.waitFor(() => expect(frames).toEqual([{ kind: 'ipc:disconnect' }]));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(controlHandle.resize(120, 40)).toBe(true);
      await vi.waitFor(() =>
        expect(frames).toEqual([
          { kind: 'ipc:disconnect' },
          { kind: 'ipc:tty-resize', cols: 120, rows: 40 },
        ]),
      );
    } finally {
      handle.kill('SIGTERM');
    }
  });

  it('delivers private listening control after disconnect without a public message', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');
    const init = (factoryWorker as FakeWorker).posted[0] as {
      spec: { stdio: { ipc: MessagePort } };
    };
    const messages: unknown[] = [];
    const controls: unknown[] = [];
    handle.on('message', (message) => messages.push(message));
    handle.onListeningControl((control) => controls.push(control));

    try {
      handle.disconnect();
      init.spec.stdio.ipc.postMessage({
        kind: 'control:listening',
        ports: [3000],
        previewScope: 'scope-a',
      });

      await vi.waitFor(() =>
        expect(controls).toEqual([{ pid: handle.pid, ports: [3000], previewScope: 'scope-a' }]),
      );
      expect(messages).toEqual([]);
    } finally {
      handle.kill('SIGTERM');
    }
  });

  it('settles only the exact run when a live private-control frame is malformed', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');
    const init = (factoryWorker as FakeWorker).posted[0] as {
      spec: { stdio: { ipc: MessagePort } };
    };
    const events: string[] = [];
    handle.on('exit', (code) => events.push(`exit:${String(code)}`));
    handle.on('close', (code) => events.push(`close:${String(code)}`));

    init.spec.stdio.ipc.postMessage({
      kind: 'control:listening',
      ports: [3000],
      previewScope: 'scope-a',
      extra: true,
    });

    await vi.waitFor(() => expect(handle.exitCode).toBe(1), { timeout: 500 });
    expect(events).toEqual(['exit:1', 'close:1']);
    expect(pm.list()).toEqual([]);
    expect((factoryWorker as FakeWorker).terminate).toHaveBeenCalledTimes(1);
  });

  it('settles current-session Worker peer death exactly once despite a late exit frame', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');
    const events: string[] = [];
    handle.on('exit', (code) => events.push(`exit:${String(code)}`));
    handle.on('close', (code) => events.push(`close:${String(code)}`));
    const worker = factoryWorker as FakeWorker;

    worker.fire(
      'error',
      new MessageEvent('error', {
        data: new Error('supervisor peer died with an active descendant'),
      }),
    );
    worker.fire('message', attestedExitEvent(worker, 0));

    await vi.waitFor(() => expect(handle.exitCode).toBe(1));
    expect(events).toEqual(['exit:1', 'close:1']);
    expect(pm.list()).toEqual([]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('fails malformed stdio before terminal instead of hanging', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');
    const worker = factoryWorker as FakeWorker;

    handle.ports.stdout.dispatchEvent(
      new MessageEvent('message', {
        data: { malformed: true },
      }),
    );

    await vi.waitFor(() => expect(handle.exitCode).toBe(1));
    expect(pm.list()).toEqual([]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects an attested Worker peer close without fabricating an exit', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
      serve: true,
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');
    const init = (factoryWorker as FakeWorker).posted[0] as {
      spec: { stdio: { ipc: MessagePort } };
    };
    const events: string[] = [];
    handle.on('peererror', (error) =>
      events.push(`peererror:${error instanceof Error ? error.message : String(error)}`),
    );
    handle.on('exit', () => events.push('exit'));
    handle.on('close', () => events.push('close'));

    sealWorkerOutputFor(factoryWorker as FakeWorker);
    init.spec.stdio.ipc.postMessage({ kind: 'control:peer-closing' });

    await vi.waitFor(() => expect(events.at(-1)).toBe('close'));
    expect(events).toEqual([
      expect.stringMatching(/^peererror:.*peer.*closed unexpectedly$/i),
      'close',
    ]);
    expect(handle.exitCode).toBeNull();
    expect(handle.signalCode).toBeNull();
    expect(pm.list()).toEqual([]);
  });

  it('settles an attested exit with its exact Worker exit code', async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');
    const init = (factoryWorker as FakeWorker).posted[0] as {
      spec: { stdio: { ipc: MessagePort } };
    };
    const events: string[] = [];
    handle.on('peererror', () => events.push('peererror'));
    handle.on('exit', (code) => events.push(`exit:${String(code)}`));
    handle.on('close', (code) => events.push(`close:${String(code)}`));

    sealWorkerOutputFor(factoryWorker as FakeWorker);
    (factoryWorker as FakeWorker).fire(
      'message',
      attestedExitEvent(factoryWorker as FakeWorker, 7),
    );

    await vi.waitFor(() => expect(events.at(-1)).toBe('close:7'));
    expect(events).toEqual(['exit:7', 'close:7']);
    expect(pm.list()).toEqual([]);
  });

  it("worker exit emits 'disconnect' once and subsequent send returns false", async () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');

    let disconnectEvents = 0;
    handle.on('disconnect', () => {
      disconnectEvents++;
    });

    const w = factoryWorker as FakeWorker;
    const exit = once(handle, 'exit');
    sealWorkerOutputFor(w);
    w.fire('message', attestedExitEvent(w, 0));
    await exit;

    expect(disconnectEvents).toBe(1);
    expect(handle.exitCode).toBe(0);
    expect(handle.send({ late: true })).toBe(false);
  });

  it("kill() emits 'disconnect' before tearing the handle down", () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    if (handle.kind !== 'worker') throw new Error('expected worker handle');

    const events: string[] = [];
    handle.on('disconnect', () => events.push('disconnect'));
    handle.on('exit', () => events.push('exit'));

    handle.kill('SIGTERM');

    expect(events).toContain('disconnect');
    expect(events).toContain('exit');
    expect(events.indexOf('disconnect')).toBeLessThan(events.indexOf('exit'));
  });
});
