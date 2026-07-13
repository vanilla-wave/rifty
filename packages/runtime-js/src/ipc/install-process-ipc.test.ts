import type { KernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNodeProcessShim } from './install-process.ts';

const originalProcess = (globalThis as { process?: unknown }).process;

function spec(): KernelProcessSpec {
  const stdout = new MessageChannel();
  const stderr = new MessageChannel();
  const stdin = new MessageChannel();
  const ipc = new MessageChannel();
  return {
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env: {},
    cwd: '/workspace',
    stdio: {
      stdout: stdout.port1,
      stderr: stderr.port1,
      stdin: stdin.port1,
      ipc: ipc.port1,
    },
  };
}

afterEach(() => {
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe('installNodeProcessShim fork-IPC (ADR-0045)', () => {
  it('exposes parent ipc:message frames as process "message" events', async () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });

    const received = new Promise((resolve) => process.on('message', resolve));
    ipc.port2.postMessage({ kind: 'ipc:message', payload: { hello: 'world' } });

    await expect(received).resolves.toEqual({ hello: 'world' });
  });

  it('delivers an ipc:message that arrives before a message listener attaches', async () => {
    // Regression (ADR-0146, owner-resident shell): the shell-owner worker registers its
    // `process.on('message')` only after its heavy entry module finishes
    // loading, but the page sends `pty:open` immediately. The shim must buffer
    // the early frame and flush it on the first listener — exactly as the stdin
    // reader already does — instead of dropping it on an emit with no listeners.
    const ipc = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });

    ipc.port2.postMessage({ kind: 'ipc:message', payload: { early: true } });
    // Force port delivery (shim onmessage fires) BEFORE any listener exists.
    await tick();

    const received = new Promise((resolve) => process.on('message', resolve));
    await expect(received).resolves.toEqual({ early: true });
  });

  it('preserves order across messages buffered before the first listener', async () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });

    ipc.port2.postMessage({ kind: 'ipc:message', payload: 1 });
    ipc.port2.postMessage({ kind: 'ipc:message', payload: 2 });
    ipc.port2.postMessage({ kind: 'ipc:message', payload: 3 });
    await tick();

    const seen: unknown[] = [];
    const drained = new Promise<void>((resolve) => {
      process.on('message', (m: unknown) => {
        seen.push(m);
        if (seen.length === 3) resolve();
      });
    });
    await drained;
    expect(seen).toEqual([1, 2, 3]);
  });

  it('keeps physical control open for a delayed tty resize after logical disconnect', async () => {
    const ipc = new MessageChannel();
    const close = vi.spyOn(ipc.port1, 'close');
    const process = installNodeProcessShim({
      ...spec(),
      env: {
        RIFTY_STDOUT_IS_TTY: '1',
        RIFTY_STDERR_IS_TTY: '1',
        RIFTY_TTY_COLS: '80',
        RIFTY_TTY_ROWS: '24',
      },
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    const disconnected = new Promise<void>((resolve) =>
      process.once('disconnect', () => resolve()),
    );

    ipc.port2.postMessage({ kind: 'ipc:disconnect' });
    await disconnected;
    await tick();
    expect(close).not.toHaveBeenCalled();

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 120, rows: 40 });
    await tick();
    expect(process.stdout).toMatchObject({ columns: 120, rows: 40 });
    expect(process.stderr).toMatchObject({ columns: 120, rows: 40 });
  });

  it('keeps child control open when process.disconnect initiates logical disconnect', async () => {
    const ipc = new MessageChannel();
    const close = vi.spyOn(ipc.port1, 'close');
    const process = installNodeProcessShim({
      ...spec(),
      env: { RIFTY_STDOUT_IS_TTY: '1' },
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    const frames: unknown[] = [];
    ipc.port2.onmessage = (event) => frames.push(event.data);
    ipc.port2.start();

    process.disconnect?.();
    await tick();
    expect(frames).toEqual([{ kind: 'ipc:disconnect' }]);
    expect(close).not.toHaveBeenCalled();

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 100, rows: 30 });
    await tick();
    expect(process.stdout).toMatchObject({ columns: 100, rows: 30 });
  });

  it('updates tty dimensions and emits stdout resize, stderr resize, then SIGWINCH once', async () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      env: {
        RIFTY_STDOUT_IS_TTY: '1',
        RIFTY_STDERR_IS_TTY: '1',
        RIFTY_TTY_COLS: '80',
        RIFTY_TTY_ROWS: '24',
      },
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    type ResizableWriter = typeof process.stdout & {
      columns: number;
      rows: number;
      getWindowSize(): [number, number];
      on(event: 'resize', listener: () => void): unknown;
    };
    const stdout = process.stdout as ResizableWriter;
    const stderr = process.stderr as ResizableWriter;
    const events: string[] = [];

    stdout.on('resize', () => events.push(`stdout:${stdout.columns}x${stdout.rows}`));
    stderr.on('resize', () => events.push(`stderr:${stderr.columns}x${stderr.rows}`));
    process.on('SIGWINCH', () => events.push('SIGWINCH'));

    expect(stdout.getWindowSize()).toEqual([80, 24]);
    expect(stderr.getWindowSize()).toEqual([80, 24]);

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 120, rows: 40 });
    await tick();

    expect(stdout).toMatchObject({ columns: 120, rows: 40 });
    expect(stderr).toMatchObject({ columns: 120, rows: 40 });
    expect(stdout.getWindowSize()).toEqual([120, 40]);
    expect(stderr.getWindowSize()).toEqual([120, 40]);
    expect(events).toEqual(['stdout:120x40', 'stderr:120x40', 'SIGWINCH']);

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 120, rows: 40 });
    await tick();
    expect(events).toEqual(['stdout:120x40', 'stderr:120x40', 'SIGWINCH']);
  });

  it('leaves non-tty stdio unchanged on tty resize control frames', async () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      env: {},
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 120, rows: 40 });
    await tick();

    expect(process.stdout).toMatchObject({ isTTY: false, fd: 1 });
    expect(process.stderr).toMatchObject({ isTTY: false, fd: 2 });
    expect(process.stdout).not.toHaveProperty('columns');
    expect(process.stdout).not.toHaveProperty('rows');
    expect(process.stdout).not.toHaveProperty('getWindowSize');
    expect(process.stderr).not.toHaveProperty('columns');
    expect(process.stderr).not.toHaveProperty('rows');
    expect(process.stderr).not.toHaveProperty('getWindowSize');
  });
});
