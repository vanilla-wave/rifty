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

describe('installNodeProcessShim stdin', () => {
  it('exposes kernel stdin as process.stdin data events', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });
    const chunks: unknown[] = [];

    process.stdin.once('data', (chunk) => chunks.push(chunk));
    stdin.port2.postMessage(new Uint8Array([0x68, 0x69]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chunks).toEqual([new Uint8Array([0x68, 0x69])]);
  });

  it('buffers stdin until a data listener attaches', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });
    const chunks: unknown[] = [];

    stdin.port2.postMessage(new Uint8Array([0x78]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.stdin.once('data', (chunk) => chunks.push(chunk));
    await Promise.resolve();

    expect(chunks).toEqual([new Uint8Array([0x78])]);
  });

  it('decodes stdin bytes when utf8 encoding is set', async () => {
    const stdin = new MessageChannel();
    const process = installNodeProcessShim({
      ...spec(),
      stdio: { ...spec().stdio, stdin: stdin.port1 },
    });
    const chunks: unknown[] = [];

    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk) => chunks.push(chunk));
    stdin.port2.postMessage(new Uint8Array([0xe2, 0x9c, 0x93]));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chunks).toEqual(['✓']);
  });
});
