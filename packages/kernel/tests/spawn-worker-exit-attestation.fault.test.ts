/**
 * `provenance-lie` × sealed exit frame. The worker-global `postMessage`
 * channel is shared with guest code, so the child seal alone cannot
 * authenticate an exit frame: it is a process-wide state word sampled when the
 * parent DELIVERS a message, not evidence about the message itself. A guest
 * that posts `{type:'exit', code:N}` before the trusted finalizer seals wins
 * the race — the frame is delivered after the seal and, per ADR-0332's
 * first-accepted-outcome rule, becomes the process exit code npm scripts and
 * nodemon act on.
 *
 * The trusted finalizer stamps every exit frame with the attestation minted
 * inside the kernel-owned output state, which guests never receive. Frames
 * without it are ordinary guest traffic on a shared channel: ignored, never a
 * fabricated exit and never a fabricated diagnostic.
 */
import { describe, expect, it } from 'vitest';
import { ProcessManager } from '../src/process-manager.ts';
import type { WorkerProcessHandle } from '../src/process-manager.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearWorkerFactoryForTests,
  setKernelWorkerUrl,
  setWorkerFactoryForTests,
} from '../src/spawn-worker.ts';
import {
  type WorkerOutputState,
  sealWorkerOutput,
  workerOutputAttestation,
} from '../src/worker-stdio-drain.ts';

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

const flushWorkerExit = () =>
  new Promise<void>((r) => setTimeout(() => setTimeout(() => setTimeout(r, 0), 0), 0));

interface SpawnedChild {
  readonly worker: FakeWorker;
  readonly outputState: WorkerOutputState;
  readonly stderr: () => string;
  readonly outcome: () => { code: number | null; settled: boolean };
}

function spawnChild(pm: ProcessManager, worker: () => FakeWorker | undefined): SpawnedChild {
  const handle = pm.spawnWorker('node', {
    entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
    argv: ['rifty', '/tmp/x.js'],
    env: {},
    cwd: '/workspace',
  }) as WorkerProcessHandle;
  const made = worker();
  if (!made) throw new Error('fake worker was not constructed');
  const init = made.posted[0] as { spec: { outputState: WorkerOutputState } };
  const decoder = new TextDecoder();
  let stderr = '';
  handle.stderr().on('data', (chunk: unknown) => {
    if (chunk instanceof Uint8Array) stderr += decoder.decode(chunk);
  });
  let code: number | null = null;
  let settled = false;
  handle.on('exit', (value: unknown) => {
    settled = true;
    code = typeof value === 'number' ? value : null;
  });
  return {
    worker: made,
    outputState: init.spec.outputState,
    stderr: () => stderr,
    outcome: () => ({ code, settled }),
  };
}

function guestFrame(data: unknown): MessageEvent {
  return { type: 'message', data } as unknown as MessageEvent;
}

describe('spawnKernelWorker — only an attested frame settles the process exit', () => {
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

  it('ignores a guest exit frame delivered after the trusted seal', async () => {
    await withFakeWorker(async (worker) => {
      const child = spawnChild(new ProcessManager(), worker);

      // Guest queues its forgery while the state is still OPEN; the parent
      // drains it only after the trusted finalizer has sealed — the exact
      // window the seal check cannot distinguish.
      sealWorkerOutput(child.outputState);
      child.worker.fire('message', guestFrame({ type: 'exit', code: 7 }));
      await flushWorkerExit();

      expect(child.outcome()).toEqual({ code: null, settled: false });
      expect(child.stderr()).toBe('');
    });
  });

  it('settles on the attested frame even after a guest forged another code', async () => {
    await withFakeWorker(async (worker) => {
      const child = spawnChild(new ProcessManager(), worker);

      sealWorkerOutput(child.outputState);
      child.worker.fire('message', guestFrame({ type: 'exit', code: 7 }));
      child.worker.fire(
        'message',
        guestFrame({
          type: 'exit',
          code: 0,
          attestation: workerOutputAttestation(child.outputState),
        }),
      );
      await flushWorkerExit();

      expect(child.outcome()).toEqual({ code: 0, settled: true });
      expect(child.stderr()).toBe('');
    });
  });

  it('ignores unrelated guest traffic instead of fabricating an exit', async () => {
    // A library that talks over the worker-global channel (emscripten/comlink
    // style) must not turn a live process into "exit 1 + malformed frame".
    await withFakeWorker(async (worker) => {
      const child = spawnChild(new ProcessManager(), worker);

      sealWorkerOutput(child.outputState);
      child.worker.fire('message', guestFrame({ hello: 'world' }));
      child.worker.fire('message', guestFrame('plain string'));
      await flushWorkerExit();

      expect(child.outcome()).toEqual({ code: null, settled: false });
      expect(child.stderr()).toBe('');
    });
  });

  it('still reports a malformed frame that carries the trusted attestation', async () => {
    await withFakeWorker(async (worker) => {
      const child = spawnChild(new ProcessManager(), worker);

      sealWorkerOutput(child.outputState);
      child.worker.fire(
        'message',
        guestFrame({
          type: 'exit',
          code: -3,
          attestation: workerOutputAttestation(child.outputState),
        }),
      );
      await flushWorkerExit();

      expect(child.stderr()).toContain('malformed sealed exit frame');
      expect(child.outcome().code).toBe(1);
    });
  });
});
