/**
 * The process end runs the fs operations in flight (Node joins its threadpool) and
 * settles nothing: rows a mutant of `completeSubmittedIo` / `ioTurn` turns red.
 */
import type { KernelProcessSpec } from '@riftydev/kernel';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { installNodeProcessShim } from '../ipc/install-process.ts';
import { resetSyncMirror, setSyncMirror } from './fs-sync-mirror.ts';
import { closeSync, openSync, promises, readFileSync, write } from './fs.ts';

const originalProcess = (globalThis as { process?: unknown }).process;

afterEach(() => {
  resetKeepalive();
  resetSyncMirror();
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
});

function setup() {
  setSyncMirror(new MemoryFsSync());
  const ipc = new MessageChannel();
  const frames: unknown[] = [];
  ipc.port2.onmessage = (event) => frames.push(event.data);
  ipc.port2.start();
  const spec: KernelProcessSpec = {
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env: {},
    cwd: '/',
    stdio: {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      stdin: new MessageChannel().port1,
      ipc: ipc.port1,
    },
  };
  return { process: installNodeProcessShim(spec), frames };
}

const turns = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
const exitSignal = (exitCode: number) =>
  expect.objectContaining({ code: 'RIFTY_PROCESS_EXIT', exitCode });

describe('process end with fs operations in flight', () => {
  it('runs a submitted write; neither its callback nor a promise settles; no turn is left', async () => {
    const { process } = setup();
    const refs = activeRefs();
    const fd = openSync('/e.txt', 'w');
    const settled: string[] = [];
    write(fd, 'data', () => settled.push('callback'));
    promises.writeFile('/p.txt', 'p').then(
      () => settled.push('resolved'),
      () => settled.push('rejected'),
    );
    expect(() => process.exit(0)).toThrow(exitSignal(0));
    expect(readFileSync('/e.txt', 'utf8')).toBe('data');
    expect(readFileSync('/p.txt', 'utf8')).toBe('p');
    await turns();
    expect(settled).toEqual([]);
    expect(activeRefs()).toBe(refs);
    closeSync(fd);
  });

  it("an operation's error at the process end neither surfaces nor changes the status", async () => {
    const { process, frames } = setup();
    const settled: unknown[] = [];
    promises.stat('/missing').catch((error: unknown) => settled.push(error));
    write(987654, 'x', (error) => settled.push(error));
    expect(() => process.exit(3)).toThrow(exitSignal(3));
    await turns();
    expect(settled).toEqual([]);
    expect(frames).toEqual([{ kind: 'control:self-exit', code: 3 }]);
  });

  it("an op submitted from an 'exit' listener that exits again runs once; nothing loops", async () => {
    const { process, frames } = setup();
    const fd = openSync('/e.txt', 'a');
    let listener = 0;
    process.on('exit', () => {
      listener++;
      write(fd, 'x', () => {});
      process.exit(2);
    });
    expect(() => process.exit(1)).toThrow(exitSignal(2));
    expect(() => process.exit(5)).toThrow();
    await turns();
    expect(listener).toBe(1);
    expect(readFileSync('/e.txt', 'utf8')).toBe('x');
    expect(frames).toEqual([{ kind: 'control:self-exit', code: 2 }]);
    closeSync(fd);
  });
});
