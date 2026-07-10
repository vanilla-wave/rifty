/** Generic Worker-backed `spawn('node', …)` / `fork()` contract (ADR-0202). */
import { Readable } from '@riftydev/io';
import { clearKernelDispatcher, setKernelWorkerUrl } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { buildWorkerChildSpec, resolveWorkerStdio } from './child_process-worker.ts';
import { spawn } from './child_process.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import { resetNodeEntryWorkerUrl, setNodeEntryWorkerUrl } from './node-entry-url.ts';

type Coi = { crossOriginIsolated?: boolean };

afterEach(() => {
  (globalThis as Coi).crossOriginIsolated = false;
  clearKernelDispatcher();
  resetNodeEntryWorkerUrl();
  resetSyncMirror();
});

describe('generic worker-spawn remote FS capability (ADR-0202)', () => {
  it('throws NotImplementedError instead of spawning an empty-mirror worker child', () => {
    (globalThis as Coi).crossOriginIsolated = true;
    setKernelWorkerUrl('https://rifty.test/kernel-worker.js');
    setNodeEntryWorkerUrl('https://rifty.test/node-entry.js');
    writeFileSync('/script.js', '');
    expect(() => spawn('node', ['/script.js'])).toThrowError(
      expect.objectContaining({ name: 'NotImplementedError' }) as unknown as Error,
    );
  });

  it('inherits parent env only when env is omitted and always selects the server lifecycle', () => {
    const inherited = buildWorkerChildSpec(
      { command: 'node', args: ['/script.js'], opts: { cwd: '/project' } },
      {
        bootstrapUrl: 'https://rifty.test/node-entry.js',
        parentCwd: '/parent',
        parentEnv: { INHERITED: 'yes' },
      },
    );
    expect(inherited).toMatchObject({
      cwd: '/project',
      spec: {
        argv: ['rifty', '/script.js'],
        env: {
          INHERITED: 'yes',
          RIFTY_BIN: '0',
          RIFTY_NODE_SERVE: '1',
          RIFTY_REMOTE_FS: '1',
        },
        serve: true,
      },
    });

    const replaced = buildWorkerChildSpec(
      {
        command: 'node',
        args: ['/script.js'],
        opts: { env: { EXPLICIT: 'yes' } },
      },
      {
        bootstrapUrl: 'https://rifty.test/node-entry.js',
        parentCwd: '/parent',
        parentEnv: { MUST_NOT_LEAK: 'parent-only' },
      },
    );
    expect(replaced.spec.env).toMatchObject({
      EXPLICIT: 'yes',
      RIFTY_BIN: '0',
      RIFTY_NODE_SERVE: '1',
      RIFTY_REMOTE_FS: '1',
    });
    expect(replaced.spec.env).not.toHaveProperty('MUST_NOT_LEAK');
  });

  it('keeps pipe parent-visible and hides streams that forward elsewhere', () => {
    expect(resolveWorkerStdio('pipe', {}, false)).toEqual({
      ipc: false,
      expose: { stdin: true, stdout: true, stderr: true },
    });

    const parentIn = new Readable({ read() {} });
    const parentOut = { write: (_chunk: unknown) => true };
    const parentErr = { write: (_chunk: unknown) => true };
    expect(
      resolveWorkerStdio(
        'inherit',
        { stdin: parentIn, stdout: parentOut, stderr: parentErr },
        false,
      ),
    ).toEqual({
      ipc: false,
      expose: { stdin: false, stdout: false, stderr: false },
      stdin: parentIn,
      stdout: parentOut,
      stderr: parentErr,
    });
  });

  it('distinguishes default fork inheritance from silent fork pipes', () => {
    const parentIn = new Readable({ read() {} });
    const parentOut = { write: (_chunk: unknown) => true };
    const parentErr = { write: (_chunk: unknown) => true };
    const inherited = { stdin: parentIn, stdout: parentOut, stderr: parentErr };

    expect(resolveWorkerStdio(undefined, inherited, true, false)).toEqual({
      ipc: true,
      expose: { stdin: false, stdout: false, stderr: false },
      stdin: parentIn,
      stdout: parentOut,
      stderr: parentErr,
    });
    expect(resolveWorkerStdio(undefined, inherited, true, true)).toEqual({
      ipc: true,
      expose: { stdin: true, stdout: true, stderr: true },
    });
  });

  it("accepts nodemon's explicit output array and preserves fork IPC", () => {
    const stdout = { write: (_chunk: unknown) => true };
    const stderr = { write: (_chunk: unknown) => true };
    expect(resolveWorkerStdio(['pipe', stdout, stderr, 'ipc'], {}, true)).toEqual({
      ipc: true,
      expose: { stdin: true, stdout: false, stderr: false },
      stdout,
      stderr,
    });
  });

  it.each(['ignore', 'overlapped'])('fails loud for unsupported valid stdio mode %s', (mode) => {
    expect(() => resolveWorkerStdio(mode, {}, false)).toThrow(
      expect.objectContaining({ name: 'NotImplementedError' }) as unknown as Error,
    );
  });

  it('fails loud for unsupported array modes, missing fork IPC, and arbitrary strings', () => {
    expect(() => resolveWorkerStdio(['pipe', 'ignore', 'pipe'], {}, false)).toThrow(
      expect.objectContaining({ name: 'NotImplementedError' }) as unknown as Error,
    );
    expect(() => resolveWorkerStdio(['pipe', 'pipe', 'pipe'], {}, true)).toThrow(
      expect.objectContaining({
        name: 'TypeError',
        code: 'ERR_CHILD_PROCESS_IPC_REQUIRED',
      }) as unknown as Error,
    );
    expect(() => resolveWorkerStdio(['pipe', 'not-a-mode', 'pipe'], {}, false)).toThrow(
      expect.objectContaining({
        name: 'TypeError',
        code: 'ERR_INVALID_ARG_VALUE',
      }) as unknown as Error,
    );
    expect(() => resolveWorkerStdio('definitely-not-stdio', {}, false)).toThrow(
      expect.objectContaining({
        name: 'TypeError',
        code: 'ERR_INVALID_ARG_VALUE',
      }) as unknown as Error,
    );
  });

  it.each([0, 1, 2])('keeps valid-but-unwired IPC placement at fd %s loud', (ipcFd) => {
    const stdio = ['pipe', 'pipe', 'pipe', 'ipc'];
    stdio[ipcFd] = 'ipc';
    stdio[3] = 'pipe';

    expect(() => resolveWorkerStdio(stdio, {}, true)).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'child_process.spawn.stdio',
      }) as unknown as Error,
    );
  });
});
