import { Writable } from '@riftydev/io';
import type { KernelProcessSpec } from '@riftydev/kernel';
import { NotImplementedError } from '@riftydev/vfs';
import { afterEach, describe, expect, it } from 'vitest';
import { applyNodeProcessTerminalBootstrap } from '../builtins/process.ts';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { installNodeProcessShim } from './install-process.ts';

const originalProcess = (globalThis as { process?: unknown }).process;
const originalGlobalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'global');

type GlobalWithNodeAlias = typeof globalThis & { global?: typeof globalThis };

function spec(env: Record<string, string> = {}): KernelProcessSpec {
  const stdout = new MessageChannel();
  const stderr = new MessageChannel();
  const stdin = new MessageChannel();
  const ipc = new MessageChannel();
  return {
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env,
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
  resetKeepalive();
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
  if (originalGlobalDescriptor) {
    Object.defineProperty(globalThis, 'global', originalGlobalDescriptor);
  } else {
    Reflect.deleteProperty(globalThis as GlobalWithNodeAlias, 'global');
  }
});

function onceData(process: ReturnType<typeof installNodeProcessShim>): Promise<unknown> {
  return new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

interface UnsupportedStdinSurface {
  readonly readable?: boolean;
  on(event: string, listener: () => void): unknown;
  once(event: string, listener: () => void): unknown;
  addListener(event: string, listener: () => void): unknown;
  prependListener(event: string, listener: () => void): unknown;
  prependOnceListener(event: string, listener: () => void): unknown;
  read(): unknown;
  pipe(destination: unknown): unknown;
  setRawMode(enabled: boolean): unknown;
  [Symbol.asyncIterator](): unknown;
}

function captureError(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('installNodeProcessShim stdin', () => {
  it('installs the Node global alias for kernel worker realms', () => {
    Reflect.deleteProperty(globalThis as GlobalWithNodeAlias, 'global');

    installNodeProcessShim(spec());

    expect((globalThis as GlobalWithNodeAlias).global).toBe(globalThis);
  });

  it('exposes kernel stdin as process.stdin data events', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });

    const chunk = onceData(process);
    stdin.port2.postMessage(new Uint8Array([0x68, 0x69]));

    await expect(chunk).resolves.toEqual(new Uint8Array([0x68, 0x69]));
  });

  it('makes every unsupported readable, pull, and raw surface a precise loud gap', () => {
    const process = installNodeProcessShim(spec());
    applyNodeProcessTerminalBootstrap(process, {
      stdinIsTTY: true,
      stdoutIsTTY: false,
      stderrIsTTY: false,
      cols: 80,
      rows: 24,
    });
    const stdin = process.stdin as UnsupportedStdinSurface;
    expect(() => stdin.readable).not.toThrow();
    const gaps: ReadonlyArray<readonly [string, () => unknown]> = [
      ['process.stdin.readable', () => stdin.on('readable', () => {})],
      ['process.stdin.readable', () => stdin.once('readable', () => {})],
      ['process.stdin.readable', () => stdin.addListener('readable', () => {})],
      ['process.stdin.readable', () => stdin.prependListener('readable', () => {})],
      ['process.stdin.readable', () => stdin.prependOnceListener('readable', () => {})],
      [
        'process.stdin.readable',
        () => {
          process.stdin.removeAllListeners('newListener');
          return stdin.on('readable', () => {});
        },
      ],
      ['process.stdin.read', () => stdin.read()],
      ['process.stdin.pipe', () => stdin.pipe(new Writable())],
      ['process.stdin[Symbol.asyncIterator]', () => stdin[Symbol.asyncIterator]()],
      ['process.stdin.setRawMode', () => stdin.setRawMode(true)],
    ];

    for (const [feature, invoke] of gaps) {
      const error = captureError(invoke);
      expect.soft(error).toBeInstanceOf(NotImplementedError);
      expect.soft(error).toMatchObject({
        name: 'NotImplementedError',
        feature,
        message: `Not implemented: ${feature}`,
      });
    }
  });

  it('delivers stdin posted before a data listener attaches', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });

    stdin.port2.postMessage(new Uint8Array([0x78]));

    await expect(onceData(process)).resolves.toEqual(new Uint8Array([0x78]));
  });

  it('decodes stdin bytes when utf8 encoding is set', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });

    expect(process.stdin.setEncoding('utf8')).toBe(process.stdin);
    const chunk = onceData(process);
    stdin.port2.postMessage(new Uint8Array([0xe2, 0x9c, 0x93]));

    await expect(chunk).resolves.toBe('✓');
  });

  it('decodes utf8 split across stdin messages', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });

    process.stdin.setEncoding('utf8');
    const chunk = onceData(process);
    stdin.port2.postMessage(new Uint8Array([0xe2, 0x82]));
    stdin.port2.postMessage(new Uint8Array([0xac]));

    await expect(chunk).resolves.toBe('€');
  });

  it('holds split utf8 data while paused and drains it only after resume', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });
    const events: string[] = [];

    process.stdin.setEncoding('utf8');
    process.stdin.pause();
    process.stdin.on('data', (chunk) => events.push(`data:${String(chunk)}`));
    stdin.port2.postMessage(new Uint8Array([0xe2, 0x82]));
    stdin.port2.postMessage(new Uint8Array([0xac]));

    await tick();
    expect(events).toEqual([]);

    process.stdin.resume();
    await tick();
    expect(events).toEqual(['data:€']);
  });

  it('turns an explicit stdin EOF frame into one ordered end and ignores late input', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });
    const events: string[] = [];

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => events.push(`data:${String(chunk)}`));
    process.stdin.on('end', () => events.push('end'));
    stdin.port2.postMessage(new Uint8Array([0xe2, 0x82]));
    stdin.port2.postMessage(new Uint8Array([0xac]));
    stdin.port2.postMessage({ kind: 'stdin:eof' });
    stdin.port2.postMessage({ kind: 'stdin:eof' });
    stdin.port2.postMessage(new Uint8Array([0x78]));

    await tick();
    expect(events).toEqual(['data:€', 'end']);
  });

  it('keeps a flowing process.stdin alive until its exact EOF', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });
    const events: string[] = [];

    process.stdin.on('data', (chunk) =>
      events.push(`data:${new TextDecoder().decode(chunk as Uint8Array)}`),
    );
    process.stdin.on('end', () => events.push('end'));
    expect(activeRefs()).toBe(1);
    process.stdin.pause();
    expect(activeRefs()).toBe(0);
    process.stdin.resume();
    expect(activeRefs()).toBe(1);

    stdin.port2.postMessage(new Uint8Array([0x78]));
    stdin.port2.postMessage({ kind: 'stdin:eof' });

    await tick();
    expect(events).toEqual(['data:x', 'end']);
    expect(activeRefs()).toBe(0);
  });

  it('keeps flowing data and end internal after public newListener observers are removed', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });
    const events: unknown[] = [];

    process.stdin.removeAllListeners('newListener');
    process.stdin.on('data', (chunk) => events.push(chunk));
    process.stdin.on('end', () => events.push('end'));
    stdin.port2.postMessage(new Uint8Array([0x78]));
    stdin.port2.postMessage({ kind: 'stdin:eof' });

    await tick();
    expect(events).toEqual([new Uint8Array([0x78]), 'end']);
  });
});
