import { afterEach, describe, expect, it } from 'vitest';
import { Readable } from '../../../packages/io/src/streams/readable.ts';
import { globalProcessManager } from '../../../packages/kernel/src/process-manager.ts';
import { exec, fork, spawn } from '../../../packages/runtime-js/src/builtins/child_process.ts';
import { resetSyncMirror } from '../../../packages/runtime-js/src/builtins/fs-sync-mirror.ts';
import { writeFileSync } from '../../../packages/runtime-js/src/builtins/fs.ts';

interface PublicChildShape {
  readonly stdin: unknown;
  readonly stdout: unknown;
  readonly stderr: unknown;
  readonly stdio: readonly unknown[];
  readonly send?: unknown;
  readonly disconnect?: unknown;
  readonly connected: boolean;
  readonly channel: unknown;
}

function readExec(
  command: string,
): Promise<{ error: (Error & { code?: number }) | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      resolve({ error: error as (Error & { code?: number }) | null, stdout, stderr });
    });
  });
}

afterEach(() => {
  for (const handle of globalProcessManager.list()) handle.kill('SIGTERM');
  resetSyncMirror();
});

describe('child_process validated stdio + optional default-JSON IPC plan', () => {
  it('rejects duplicate fork IPC before publishing a PID', () => {
    writeFileSync('/empty.js', '');
    const before = globalProcessManager.list().length;
    let error: unknown;

    try {
      fork('/empty.js', [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc', 'ipc'],
      } as never);
    } catch (caught) {
      error = caught;
    }
    const after = globalProcessManager.list().length;

    expect(error).toMatchObject({
      name: 'TypeError',
      code: 'ERR_INVALID_ARG_VALUE',
    });
    expect(after).toBe(before);
  });

  it('keeps plain spawn IPC-absent and gives nodemon fork four null stdio slots', () => {
    writeFileSync('/empty.js', '');
    const plain = spawn('node', ['/empty.js']) as unknown as PublicChildShape;
    expect(typeof plain.send).toBe('undefined');
    expect(typeof plain.disconnect).toBe('undefined');
    expect(plain.connected).toBe(false);
    expect(typeof plain.channel).toBe('undefined');

    const forked = fork('/empty.js', [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    } as never) as unknown as PublicChildShape;

    expect([forked.stdin, forked.stdout, forked.stderr]).toEqual([null, null, null]);
    expect(forked.stdio).toEqual([null, null, null, null]);
    expect(forked.connected).toBe(true);
    expect(typeof forked.send).toBe('function');
    const forkIpc = forked as {
      send(...args: unknown[]): boolean;
      channel: { ref(): void; unref(): void };
    };
    expect(() => forkIpc.send({}, null)).toThrow(/child_process\.send\.arguments/);
    expect(() => forkIpc.channel.ref()).toThrow(/child_process\.channel\.ref/);
    expect(() => forkIpc.channel.unref()).toThrow(/child_process\.channel\.unref/);

    const input = new Readable({ read() {} });
    const output = { write: (_chunk: unknown) => true };
    const explicit = spawn('node', ['/empty.js'], {
      stdio: [input, output, output],
    } as never) as unknown as PublicChildShape;
    expect([explicit.stdin, explicit.stdout, explicit.stderr]).toEqual([null, null, null]);
    expect(explicit.stdio).toEqual([null, null, null]);
  });

  it('uses Node default JSON both ways and recovers after a circular send', async () => {
    writeFileSync(
      '/echo.js',
      `const p = typeof __process === 'undefined' ? process : __process;
       const onMessage = typeof p.onMessage === 'function'
         ? (handler) => p.onMessage(handler)
         : (handler) => p.on('message', handler);
       p.send({ fromChild: 1, drop() {} });
       onMessage((message) => p.send(message));`,
    );
    const child = fork('/echo.js') as unknown as PublicChildShape & {
      on(event: string, listener: (value: unknown) => void): void;
      send(value: unknown): boolean;
      disconnect(): void;
    };
    const replies: unknown[] = [];
    child.on('message', (message) => replies.push(message));
    await Promise.resolve();
    await Promise.resolve();

    expect(child.send({ keep: 1, drop() {} })).toBe(true);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => child.send(circular)).toThrow(/circular/i);
    expect(child.send({ after: true })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(replies).toEqual([{ fromChild: 1 }, { keep: 1 }, { after: true }]);
    child.disconnect();
    expect(child.connected).toBe(false);
  });
});

describe('child_process finite ps/kill gap siblings', () => {
  it.each(['ps -ef', 'ps -A -o pid,ppid', 'ps aux'])(
    'keeps unsupported exec form %s loud instead of reporting ENOENT',
    async (command) => {
      const result = await readExec(command);

      expect(result.error?.code).toBe(1);
      expect(result.stderr).toMatch(/NotImplementedError.*child_process.*ps/i);
      expect(result.stderr).not.toMatch(/ENOENT/i);
    },
  );

  it('keeps the spawn sibling of unsupported ps formats equally loud', async () => {
    const child = spawn('ps', ['-ef']);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array);
    });
    const code = await new Promise<number | null>((resolve) => {
      child.on('close', (value) => resolve(value as number | null));
    });
    await Promise.resolve();

    expect(code).toBe(1);
    expect(stderr).toMatch(/NotImplementedError.*child_process.*ps/i);
    expect(stderr).not.toMatch(/ENOENT/i);
  });

  it.each(['kill -TERM 2', 'kill -USR2', 'kill -USR2 -2', 'kill 2'])(
    'keeps unsupported exec form %s loud instead of approximating a shell',
    async (command) => {
      const result = await readExec(command);

      expect(result.error?.code).toBe(1);
      expect(result.stderr).toMatch(/NotImplementedError.*child_process.*kill/i);
      expect(result.stderr).not.toMatch(/ENOENT/i);
    },
  );

  it('preserves the existing unknown-executable ENOENT-127 sibling', async () => {
    const result = await readExec('definitely-not-a-command');

    expect(result.error?.code).toBe(127);
    expect(result.stderr).toBe('spawn definitely-not-a-command ENOENT\n');
    expect(result.error?.message).not.toMatch(/NotImplementedError/i);
  });
});
