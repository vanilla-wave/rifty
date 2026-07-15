import type { KernelProcessSpec } from '@riftydev/kernel';
import { NotImplementedError } from '@riftydev/vfs';
import { afterEach, describe, expect, it } from 'vitest';
import { resetNodeEntryWorkerUrl, setNodeEntryWorkerUrl } from '../builtins/node-entry-url.ts';
import { NodeProcess } from '../builtins/process.ts';
import * as recursiveRunner from './recursive-runner.ts';

type RecursiveRunnerContract = typeof recursiveRunner & {
  buildRecursiveWorkerEnv(
    userEnv: Readonly<Record<string, string>>,
    runtimeEnv: Readonly<Record<string, string>>,
  ): Record<string, string>;
};

const { makeRecursiveRunner } = recursiveRunner;
const buildRecursiveWorkerEnv = (recursiveRunner as RecursiveRunnerContract)
  .buildRecursiveWorkerEnv;

function seededProcess(env: Readonly<Record<string, string>>): NodeProcess {
  const port = (): MessagePort => new MessageChannel().port1;
  return new NodeProcess({
    pid: 2,
    ppid: 1,
    argv: ['rifty', '/child.js'],
    env,
    cwd: '/workspace',
    stdio: { stdout: port(), stderr: port(), stdin: port(), ipc: port() },
  } satisfies KernelProcessSpec);
}

describe('makeRecursiveRunner', () => {
  afterEach(() => resetNodeEntryWorkerUrl());

  it('merges user env, then host bootstrap values, then operation controls', () => {
    expect(
      buildRecursiveWorkerEnv(
        {
          USER_VALUE: 'explicit',
          RIFTY_SQLITE_WASM_URL: 'https://user.test/sqlite.wasm',
          RIFTY_BIN: 'user',
          RIFTY_REMOTE_FS: 'user',
        },
        {
          RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
          RIFTY_BIN: 'host',
          RIFTY_REMOTE_FS: 'host',
        },
      ),
    ).toEqual({
      USER_VALUE: 'explicit',
      RIFTY_SQLITE_WASM_URL: 'https://host.test/sqlite.wasm',
      RIFTY_BIN: '0',
      RIFTY_REMOTE_FS: '1',
    });
  });

  it('inherits runtime-owned loud stdin in the RIFTY_NODE_SERVE-unset execSync child', () => {
    const env = buildRecursiveWorkerEnv({}, { RIFTY_KERNEL_WORKER_URL: 'kernel.js' });
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
    ).toThrow(/node-entry.*runtime config.*not configured/i);
  });
});
