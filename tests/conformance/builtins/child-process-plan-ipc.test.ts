import { afterEach, describe, expect, it } from 'vitest';
import { Readable } from '../../../packages/io/src/streams/readable.ts';
import { globalProcessManager } from '../../../packages/kernel/src/process-manager.ts';
import { fork, spawn } from '../../../packages/runtime-js/src/builtins/child_process.ts';
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
    expect(plain.channel).toBeNull();

    const input = new Readable({ read() {} });
    const output = { write: (_chunk: unknown) => true };
    const forked = fork('/empty.js', [], {
      stdio: [input, output, output, 'ipc'],
    } as never) as unknown as PublicChildShape;

    expect([forked.stdin, forked.stdout, forked.stderr]).toEqual([null, null, null]);
    expect(forked.stdio).toEqual([null, null, null, null]);
    expect(forked.connected).toBe(true);
    expect(typeof forked.send).toBe('function');
  });

  it('uses Node default JSON both ways and recovers after a circular send', async () => {
    writeFileSync(
      '/echo.js',
      `const p = typeof __process === 'undefined' ? process : __process;
       const onMessage = typeof p.onMessage === 'function'
         ? (handler) => p.onMessage(handler)
         : (handler) => p.on('message', handler);
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

    expect(replies).toEqual([{ keep: 1 }, { after: true }]);
    child.disconnect();
    expect(child.connected).toBe(false);
  });
});
