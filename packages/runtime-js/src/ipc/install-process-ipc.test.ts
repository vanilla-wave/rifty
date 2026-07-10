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
    capabilities: { stdin: 'forwarded', runtimeIpc: true },
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

describe('installNodeProcessShim fork-IPC (ADR-0211)', () => {
  it('does not publish Node IPC when the Worker capability is control-only', () => {
    const process = installNodeProcessShim({
      ...spec(),
      capabilities: { stdin: 'forwarded', runtimeIpc: false },
    } as KernelProcessSpec);

    expect(process.send).toBeUndefined();
    expect(process.disconnect).toBeUndefined();
    expect(process.connected).toBeUndefined();
    expect(process.channel).toBeUndefined();
    expect(Object.hasOwn(process, 'send')).toBe(false);
    expect(Object.hasOwn(process, 'disconnect')).toBe(false);
    expect(Object.hasOwn(process, 'connected')).toBe(false);
    expect(Object.hasOwn(process, 'channel')).toBe(false);
  });

  it('keeps the Node IPC facade after disconnect with a null channel', () => {
    const process = installNodeProcessShim(spec());
    let disconnects = 0;
    process.on('disconnect', () => {
      disconnects += 1;
    });

    process.disconnect?.();

    expect(typeof process.send).toBe('function');
    expect(typeof process.disconnect).toBe('function');
    expect(process.connected).toBe(false);
    expect(process.channel).toBeNull();
    expect(Object.hasOwn(process, 'send')).toBe(true);
    expect(Object.hasOwn(process, 'disconnect')).toBe(true);
    expect(Object.hasOwn(process, 'connected')).toBe(true);
    expect(Object.hasOwn(process, 'channel')).toBe(true);
    expect(process.send?.({ late: true })).toBe(false);
    process.disconnect?.();
    expect(disconnects).toBe(1);
  });

  it('keeps process.channel ref/unref loud without exposing the raw control port', () => {
    const process = installNodeProcessShim(spec());
    const channel = process.channel as { ref(): unknown; unref(): unknown };

    expect(() => channel.ref()).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'process.channel.ref',
      }) as unknown as Error,
    );
    expect(() => channel.unref()).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'process.channel.unref',
      }) as unknown as Error,
    );
  });

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

  it('JSON-serializes public process.send payloads without poisoning the IPC channel', async () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, ipc: ipc.port1 },
    });
    const frames: unknown[] = [];
    ipc.port2.onmessage = (event) => frames.push(event.data);
    ipc.port2.start();

    expect(process.send?.({ keep: 1, drop() {} })).toBe(true);
    expect(process.send?.({ after: true })).toBe(true);
    await tick();

    expect(frames).toEqual([
      { kind: 'ipc:message', payload: { keep: 1 } },
      { kind: 'ipc:message', payload: { after: true } },
    ]);
  });

  it('a circular process.send payload throws but leaves the next send connected', async () => {
    const ipc = new MessageChannel();
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
});
