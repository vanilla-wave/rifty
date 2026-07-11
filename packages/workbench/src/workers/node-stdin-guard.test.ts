import type { KernelProcessSpec } from '@riftydev/kernel';
import { installNodeProcessShim } from '@riftydev/runtime-js/install-process';
import { NotImplementedError } from '@riftydev/vfs';
import { afterEach, describe, expect, it } from 'vitest';
import { installStdinCapabilityGuards } from './node-stdin-guard.ts';

// Guard the REAL spec-seeded process (makeStdinReader-backed stdin), NOT a
// synthetic `{ stdin: {} }` — the old test was false-green (it asserted the stub's
// own throwers, never the real EventEmitter's on/setEncoding/resume/pause).
const originalProcess = (globalThis as { process?: unknown }).process;
afterEach(() => {
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
});

function realSeededProcess(): {
  readonly process: { stdin: unknown };
  send(data: Uint8Array): void;
  dispose(): void;
} {
  const stdout = new MessageChannel();
  const stderr = new MessageChannel();
  const stdin = new MessageChannel();
  const ipc = new MessageChannel();
  const spec: KernelProcessSpec = {
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
  return {
    process: installNodeProcessShim(spec) as unknown as { stdin: unknown },
    send: (data) => stdin.port2.postMessage(data),
    dispose() {
      for (const channel of [stdout, stderr, stdin, ipc]) {
        channel.port1.close();
        channel.port2.close();
      }
    },
  };
}

interface LoudStdin {
  isTTY: boolean;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  once(event: string, cb: (...args: unknown[]) => void): unknown;
  addListener(event: string, cb: (...args: unknown[]) => void): unknown;
  prependListener(event: string, cb: (...args: unknown[]) => void): unknown;
  prependOnceListener(event: string, cb: (...args: unknown[]) => void): unknown;
  read(): unknown;
  resume(): unknown;
  pause(): unknown;
  setEncoding(enc: string): unknown;
  setRawMode(raw: boolean): unknown;
  pipe(dest: unknown): unknown;
  [Symbol.asyncIterator](): unknown;
}

describe('installStdinCapabilityGuards (real seeded process.stdin)', () => {
  it('keeps the implemented flowing data + UTF-8 decoder path live', async () => {
    const seeded = realSeededProcess();
    installStdinCapabilityGuards(seeded.process);
    const s = seeded.process.stdin as LoudStdin;
    try {
      expect(() => s.setEncoding('utf8')).not.toThrow();
      expect(() => s.resume()).not.toThrow();
      const chunk = new Promise<unknown>((resolve) => s.once('data', resolve));
      seeded.send(new TextEncoder().encode('controller write'));
      await expect(chunk).resolves.toBe('controller write');
    } finally {
      seeded.dispose();
    }
  });

  it('keeps unsupported pull/stream/raw consume paths loud', () => {
    const seeded = realSeededProcess();
    installStdinCapabilityGuards(seeded.process);
    const s = seeded.process.stdin as LoudStdin;
    // Pull-mode `readable` stays a loud ceiling; flowing `data` is supported.
    expect(() => s.on('readable', () => {})).toThrow(NotImplementedError);
    expect(() => s.prependOnceListener('readable', () => {})).toThrow(NotImplementedError);
    expect(() => s.read()).toThrow(/process\.stdin/);
    expect(() => s.pipe({})).toThrow(NotImplementedError);
    expect(() => s[Symbol.asyncIterator]()).toThrow(NotImplementedError);
    expect(() => s.setRawMode(true)).toThrow(NotImplementedError);
    seeded.dispose();
  });

  it('keeps non-consume listeners, passive isTTY, and a defensive pause() safe', () => {
    const seeded = realSeededProcess();
    installStdinCapabilityGuards(seeded.process);
    const s = seeded.process.stdin as LoudStdin;
    // 'end'/'close' etc. must still register (the reader's own end-handler relies on it).
    expect(() => s.on('end', () => {})).not.toThrow();
    expect(s.isTTY).toBe(false);
    // pause() on an unread stream is a Node no-op a non-reading CLI uses to exit —
    // must NOT throw (else it kills a legit program that never reads stdin).
    expect(() => s.pause()).not.toThrow();
    seeded.dispose();
  });
});
