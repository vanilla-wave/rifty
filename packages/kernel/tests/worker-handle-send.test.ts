import { NotImplementedError } from '@rifty/io';
/**
 * Verifies that the Worker-backed `ProcessHandle.send()` is a loud stub
 * rather than a silent `return false` (per CLAUDE.md "no silent stubs").
 *
 * The fork-mode IPC channel for Worker-backed children is still pending —
 * see ADR-0011 phase 2 follow-ups and the M6 "Open acceptance" entry in
 * TASKS.md ("ChildProcess.stdin IPC ... currently a loud-throw stub").
 * Until the IPC plumbing lands, calling `.send()` must throw so callers
 * can't accidentally rely on a fake `false` return value.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProcessManager } from '../src/process-manager.ts';
import { clearKernelWorkerUrl, setKernelWorkerUrl } from '../src/spawn-worker.ts';
import {
  type WorkerLike,
  clearKernelDispatcher,
  clearWorkerFactoryForTests,
  setWorkerFactoryForTests,
} from '../src/spawn-worker.ts';

class StubWorker implements WorkerLike {
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

describe('ProcessHandle.send (Worker-backed) — ADR-0011 phase 2 follow-up', () => {
  beforeEach(() => {
    setKernelWorkerUrl('https://example.invalid/kernel-worker.js');
    setWorkerFactoryForTests(() => new StubWorker());
  });

  afterEach(() => {
    clearWorkerFactoryForTests();
    clearKernelWorkerUrl();
    clearKernelDispatcher();
  });

  it('throws NotImplementedError (no silent stub)', () => {
    const pm = new ProcessManager();
    const handle = pm.spawnWorker('node', {
      entry: { kind: 'source', code: 'void 0;', sourceUrl: '/tmp/x.js' },
      argv: ['rifty', '/tmp/x.js'],
      env: {},
      cwd: '/workspace',
    });
    expect(() => handle.send({ hello: 'world' })).toThrow(NotImplementedError);
    expect(() => handle.send({ hello: 'world' })).toThrow(/kernel\.WorkerHandle\.send/);
    handle.kill('SIGTERM');
  });
});
