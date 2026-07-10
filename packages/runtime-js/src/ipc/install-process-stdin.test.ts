import { Readable, Writable } from '@riftydev/io';
import type { KernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { installNodeProcessShim } from './install-process.ts';

const originalProcess = (globalThis as { process?: unknown }).process;
const originalGlobalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'global');

type GlobalWithNodeAlias = typeof globalThis & { global?: typeof globalThis };

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
    capabilities: { stdin: 'forwarded', runtimeIpc: false },
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

  it('maps the framed Worker stdin protocol to data followed by one EOF', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });
    const chunks: unknown[] = [];
    let ends = 0;
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      ends += 1;
    });

    stdin.port2.postMessage({ kind: 'stdin:data', data: new Uint8Array([0x6f, 0x6b]) });
    stdin.port2.postMessage({ kind: 'stdin:end' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(chunks).toEqual([new Uint8Array([0x6f, 0x6b])]);
    expect(ends).toBe(1);
    expect(process.stdin.readableEnded).toBe(true);
  });

  it('is a real Readable whose passive unpipe cleanup accepts a child stdin', () => {
    const process = installNodeProcessShim(spec());
    const childStdin = new Writable();

    expect(process.stdin).toBeInstanceOf(Readable);
    expect(process.stdin.unpipe(childStdin)).toBe(process.stdin);
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

    process.stdin.setEncoding('utf8');
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
});
