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

function onceData(process: ReturnType<typeof installNodeProcessShim>): Promise<unknown> {
  return new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });
}

describe('installNodeProcessShim stdin', () => {
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
