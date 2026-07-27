import { type KernelProcessSpec, publishKernelEntryBootstrap } from '@riftydev/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildNodeEntryWorkerEntry } from '../builtins/node-entry-runtime-config.ts';
import {
  applyNodeProcessTerminalBootstrap,
  bindNodeProcessDescendantAuthority,
  postNodeProcessListeningControl,
} from '../builtins/process.ts';
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
      stdout: { write: (bytes) => stdout.port1.postMessage(bytes) },
      stderr: { write: (bytes) => stderr.port1.postMessage(bytes) },
      stdin: stdin.port1,
      ipc: ipc.port1,
    },
  };
}

afterEach(() => {
  publishKernelEntryBootstrap(null);
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

  it('throws child-origin circular JSON synchronously without closing the channel', async () => {
    const ipc = new MessageChannel();
    const entry = buildNodeEntryWorkerEntry(
      'https://host.test/node-entry.js',
      { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' },
      { kind: 'program', bin: false, remoteFs: true, ipc: 'json', nodeServe: true },
    );
    publishKernelEntryBootstrap(entry.bootstrap ?? null);
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    const frames: unknown[] = [];
    ipc.port2.onmessage = (event) => frames.push(event.data);
    ipc.port2.start();
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(() => process.send?.(circular)).toThrow(/circular/i);
    expect(process.send?.({ after: true })).toBe(true);
    await tick();
    expect(frames).toEqual([{ kind: 'ipc:message', payload: { after: true } }]);
  });

  it('reports an exact child-side failure for a malformed private frame', async () => {
    const ipc = new MessageChannel();
    installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    const response = new Promise<unknown>((resolve) => {
      ipc.port2.onmessage = (event) => resolve(event.data);
      ipc.port2.start();
    });

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 80, rows: 24, extra: true });

    await expect(response).resolves.toEqual({ kind: 'control:self-exit', code: 1 });
  });

  it('keeps unsupported process IPC arguments and channel controls loud by name', () => {
    const process = installNodeProcessShim(spec());

    expect(() => (process.send as (...args: unknown[]) => unknown)({}, null)).toThrow(
      /process\.send\.arguments/,
    );
    expect(() => (process.channel as { ref(): void }).ref()).toThrow(/process\.channel\.ref/);
    expect(() => (process.channel as { unref(): void }).unref()).toThrow(/process\.channel\.unref/);
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
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    applyNodeProcessTerminalBootstrap(process, {
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 80,
      rows: 24,
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
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    applyNodeProcessTerminalBootstrap(process, {
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: false,
      cols: 80,
      rows: 24,
    });
    const frames: unknown[] = [];
    ipc.port2.onmessage = (event) => frames.push(event.data);
    ipc.port2.start();

    process.disconnect?.();
    postNodeProcessListeningControl(process, [3000], 'scope-a');
    await tick();
    expect(frames).toEqual([
      { kind: 'ipc:disconnect' },
      { kind: 'control:listening', ports: [3000], previewScope: 'scope-a' },
    ]);
    expect(close).not.toHaveBeenCalled();

    ipc.port2.postMessage({ kind: 'ipc:tty-resize', cols: 100, rows: 30 });
    await tick();
    expect(process.stdout).toMatchObject({ columns: 100, rows: 30 });
  });

  it('updates tty dimensions and emits stdout resize, stderr resize, then SIGWINCH once', async () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    applyNodeProcessTerminalBootstrap(process, {
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 80,
      rows: 24,
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

  it('treats a teardown kill for an already-retired descendant as idempotent', async () => {
    const ipc = new MessageChannel();
    installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });

    ipc.port2.postMessage({
      kind: 'control:kill-tree',
      pid: 987_654,
      signal: 'SIGTERM',
    });

    await expect(tick()).resolves.toBeUndefined();
  });

  it('routes teardown kill through the node-entry bundle process authority', async () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    const authority = {
      kill: vi.fn(() => true),
      snapshot: vi.fn(() => [{ pid: 41 }]),
    };
    bindNodeProcessDescendantAuthority(process, authority);

    ipc.port2.postMessage({
      kind: 'control:kill-tree',
      pid: 41,
      signal: 'SIGTERM',
    });
    await tick();

    expect(authority.kill).toHaveBeenCalledWith(41, 'SIGTERM');
    expect(authority.snapshot).not.toHaveBeenCalled();
    expect(() => bindNodeProcessDescendantAuthority(process, authority)).toThrow(
      /descendant process authority is already bound/i,
    );
  });
});
