import { type KernelProcessSpec, setKernelWorkerUrl } from '@riftydev/kernel';
import { NotImplementedError } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureNodeEntryWorker,
  resetNodeEntryWorkerUrl,
  setNodeEntryWorkerUrl,
} from '../builtins/node-entry-url.ts';
import { NodeProcess } from '../builtins/process.ts';
import {
  closeKernelWorkerPeer,
  installKernelWorkerBoundary,
} from '../internal/kernel-worker-boundary.test-helper.ts';
import * as recursiveRunner from './recursive-runner.ts';

type RecursiveRunnerContract = typeof recursiveRunner & {
  buildRecursiveWorkerEnv(userEnv: Readonly<Record<string, string>>): Record<string, string>;
};

const { makeRecursiveRunner } = recursiveRunner;
const buildRecursiveWorkerEnv = (recursiveRunner as RecursiveRunnerContract)
  .buildRecursiveWorkerEnv;

function seededProcess(env: Readonly<Record<string, string>>): NodeProcess {
  const port = (): MessagePort => new MessageChannel().port1;
  const writer = (target: MessagePort) => ({
    write: (bytes: Uint8Array) => target.postMessage(bytes),
  });
  return new NodeProcess({
    pid: 2,
    ppid: 1,
    argv: ['rifty', '/child.js'],
    env,
    cwd: '/workspace',
    stdio: { stdout: writer(port()), stderr: writer(port()), stdin: port(), ipc: port() },
  } satisfies KernelProcessSpec);
}

describe('makeRecursiveRunner', () => {
  afterEach(() => {
    resetNodeEntryWorkerUrl();
    vi.restoreAllMocks();
  });

  it('keeps the guest env exact; host bootstrap and launch role are out of band', () => {
    expect(
      buildRecursiveWorkerEnv({
        USER_VALUE: 'explicit',
        RIFTY_SQLITE_WASM_URL: 'https://user.test/sqlite.wasm',
        RIFTY_BIN: 'user',
        RIFTY_REMOTE_FS: 'user',
      }),
    ).toEqual({
      USER_VALUE: 'explicit',
      RIFTY_SQLITE_WASM_URL: 'https://user.test/sqlite.wasm',
      RIFTY_BIN: 'user',
      RIFTY_REMOTE_FS: 'user',
    });
  });

  it('inherits runtime-owned loud stdin in the RIFTY_NODE_SERVE-unset execSync child', () => {
    const env = buildRecursiveWorkerEnv({});
    expect(env.RIFTY_NODE_SERVE).toBeUndefined();
    const stdin = seededProcess(env).stdin as NodeProcess['stdin'] & {
      read(): unknown;
      [Symbol.asyncIterator](): unknown;
    };

    expect(() => stdin.on('readable', () => {})).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'process.stdin.readable',
      }),
    );
    expect(() => stdin[Symbol.asyncIterator]()).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'process.stdin[Symbol.asyncIterator]',
      }),
    );
    expect(() => stdin.read()).toThrow(NotImplementedError);
  });

  it('fails loud when the node-entry worker URL is not configured', () => {
    resetNodeEntryWorkerUrl();
    const run = makeRecursiveRunner();

    expect(() =>
      run({
        entryPath: '/missing.js',
        argv: ['rifty', '/missing.js'],
        env: {},
        cwd: '/',
      }),
    ).toThrow(/node-entry worker URL not configured/);
  });

  it('fails loud before spawn when only the URL compatibility seam was configured', () => {
    setNodeEntryWorkerUrl('https://host.test/node.js');
    const run = makeRecursiveRunner();

    expect(() =>
      run({
        entryPath: '/child.js',
        argv: ['rifty', '/child.js'],
        env: {},
        cwd: '/project',
      }),
    ).toThrow(/node-entry.*bootstrap config.*not configured/i);
  });

  it('rejects when the recursive worker peer dies instead of leaving its sync caller pending', async () => {
    const restoreWorker = installKernelWorkerBoundary(closeKernelWorkerPeer);
    setKernelWorkerUrl('https://host.test/kernel-worker.js');
    configureNodeEntryWorker('https://host.test/node.js', {
      RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel-worker.js',
      RIFTY_NODE_ENTRY_WORKER_URL: 'https://host.test/node.js',
    });
    try {
      const run = makeRecursiveRunner();
      await expect(
        run({
          entryPath: '/child.js',
          argv: ['rifty', '/child.js'],
          env: {},
          cwd: '/project',
        }),
      ).rejects.toThrow(/peer.*closed unexpectedly/i);
    } finally {
      restoreWorker();
    }
  });
});
