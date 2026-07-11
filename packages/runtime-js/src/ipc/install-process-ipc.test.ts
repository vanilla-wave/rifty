import type { KernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('applies tty resize control frames before SIGWINCH without leaking a message event', async () => {
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
    const stdout = process.stdout as typeof process.stdout & {
      columns: number;
      rows: number;
      getWindowSize(): [number, number];
      on(event: 'resize', listener: () => void): void;
    };
    const events: string[] = [];
    const messages: unknown[] = [];
    stdout.on('resize', () => events.push(`resize:${stdout.columns}x${stdout.rows}`));
    process.on('SIGWINCH', (signal) => events.push(String(signal)));
    process.on('message', (message) => messages.push(message));

    expect({ columns: stdout.columns, rows: stdout.rows }).toEqual({ columns: 80, rows: 24 });
    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 132, rows: 43 });
    await tick();

    expect({ columns: stdout.columns, rows: stdout.rows }).toEqual({ columns: 132, rows: 43 });
    expect(stdout.getWindowSize()).toEqual([132, 43]);
    expect(events).toEqual(['resize:132x43', 'SIGWINCH']);
    expect(messages).toEqual([]);

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 132, rows: 43 });
    await tick();
    expect(events).toEqual(['resize:132x43', 'SIGWINCH']);
  });

  it('continues receiving tty controls after the user IPC channel disconnects', async () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      env: { RIFTY_STDOUT_IS_TTY: '1', RIFTY_TTY_COLS: '80', RIFTY_TTY_ROWS: '24' },
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    const disconnected = new Promise<void>((resolve) =>
      process.once('disconnect', () => resolve()),
    );
    ipc.port2.postMessage({ kind: 'ipc:disconnect' });
    await disconnected;

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 120, rows: 40 });
    await tick();
    expect(process.stdout).toMatchObject({ columns: 120, rows: 40 });
  });
});
