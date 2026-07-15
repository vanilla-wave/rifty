import { Writable } from '@riftydev/io';
import type { KernelProcessSpec } from '@riftydev/kernel';
import { installNodeProcessShim } from '@riftydev/runtime-js/install-process';
import { NotImplementedError } from '@riftydev/vfs';
import { afterEach, describe, expect, it } from 'vitest';

// Exercise the REAL serve-child process before node-entry-bootstrap runs. Loud
// gaps must already belong to runtime-js; a bootstrap decorator is sibling drift.
const originalProcess = (globalThis as { process?: unknown }).process;
afterEach(() => {
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
});

function realSeededProcess(): { stdin: unknown } {
  const port = (): MessagePort => new MessageChannel().port1;
  const spec: KernelProcessSpec = {
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env: { RIFTY_NODE_SERVE: '1', RIFTY_STDIN_IS_TTY: '1' },
    cwd: '/workspace',
    stdio: { stdout: port(), stderr: port(), stdin: port(), ipc: port() },
  };
  return installNodeProcessShim(spec) as unknown as { stdin: unknown };
}

interface LoudStdin {
  isTTY: boolean;
  readonly readable?: boolean;
  on(event: string, cb: () => void): unknown;
  once(event: string, cb: () => void): unknown;
  addListener(event: string, cb: () => void): unknown;
  prependListener(event: string, cb: () => void): unknown;
  prependOnceListener(event: string, cb: () => void): unknown;
  read(): unknown;
  resume(): unknown;
  pause(): unknown;
  setEncoding(enc: string): unknown;
  setRawMode(raw: boolean): unknown;
  pipe(dest: unknown): unknown;
  [Symbol.asyncIterator](): unknown;
}

describe('serve bootstrap uses runtime-owned NodeStdin gaps', () => {
  it('needs no playground guard for unsupported pull and raw-mode surfaces', () => {
    const proc = realSeededProcess();
    const s = proc.stdin as LoudStdin;
    expect(() => s.on('data', () => {})).not.toThrow();
    expect(() => s.on('readable', () => {})).toThrow(
      expect.objectContaining({ feature: 'process.stdin.readable' }),
    );
    expect(() => s.prependOnceListener('readable', () => {})).toThrow(
      expect.objectContaining({ feature: 'process.stdin.readable' }),
    );
    expect(() => s.read()).toThrow(expect.objectContaining({ feature: 'process.stdin.read' }));
    expect(() => s.pipe(new Writable())).toThrow(
      expect.objectContaining({ feature: 'process.stdin.pipe' }),
    );
    expect(() => s[Symbol.asyncIterator]()).toThrow(
      expect.objectContaining({ feature: 'process.stdin[Symbol.asyncIterator]' }),
    );
    expect(() => s.resume()).not.toThrow();
    expect(() => s.setEncoding('utf8')).not.toThrow();
    expect(() => s.setRawMode(true)).toThrow(
      expect.objectContaining({ feature: 'process.stdin.setRawMode' }),
    );
    expect(() => s.setRawMode(true)).toThrow(NotImplementedError);
  });

  it('keeps non-consume listeners, passive isTTY, and a defensive pause() safe', () => {
    const proc = realSeededProcess();
    const s = proc.stdin as LoudStdin;
    // 'end'/'close' etc. must still register (the reader's own end-handler relies on it).
    expect(() => s.on('end', () => {})).not.toThrow();
    expect(s.isTTY).toBe(true);
    expect(() => s.readable).not.toThrow();
    // pause() on an unread stream is a Node no-op a non-reading CLI uses to exit —
    // must NOT throw (else it kills a legit program that never reads stdin).
    expect(() => s.pause()).not.toThrow();
  });
});
