import type { KernelProcessSpec } from '@riftydev/kernel';
import { installNodeProcessShim } from '@riftydev/runtime-js/install-process';
import { NotImplementedError } from '@riftydev/vfs';
import { afterEach, describe, expect, it } from 'vitest';
import { installLoudStdin } from './node-stdin-guard.ts';

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

function realSeededProcess(): { stdin: unknown } {
  const port = (): MessagePort => new MessageChannel().port1;
  const spec: KernelProcessSpec = {
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env: {},
    cwd: '/workspace',
    stdio: { stdout: port(), stderr: port(), stdin: port(), ipc: port() },
  };
  return installNodeProcessShim(spec) as unknown as { stdin: unknown };
}

interface LoudStdin {
  isTTY: boolean;
  on(event: string, cb: () => void): unknown;
  once(event: string, cb: () => void): unknown;
  addListener(event: string, cb: () => void): unknown;
  prependListener(event: string, cb: () => void): unknown;
  read(): unknown;
  resume(): unknown;
  pause(): unknown;
  setEncoding(enc: string): unknown;
  setRawMode(raw: boolean): unknown;
  pipe(dest: unknown): unknown;
  [Symbol.asyncIterator](): unknown;
}

describe('installLoudStdin (real seeded process.stdin)', () => {
  it('makes every consume path throw NotImplementedError, never a silent hang', () => {
    const proc = realSeededProcess();
    installLoudStdin(proc);
    const s = proc.stdin as LoudStdin;
    // data-listener-add
    expect(() => s.on('data', () => {})).toThrow(NotImplementedError);
    expect(() => s.once('data', () => {})).toThrow(NotImplementedError);
    expect(() => s.addListener('data', () => {})).toThrow(NotImplementedError);
    expect(() => s.prependListener('data', () => {})).toThrow(NotImplementedError);
    // readable
    expect(() => s.read()).toThrow(/process\.stdin/);
    expect(() => s.pipe({})).toThrow(NotImplementedError);
    expect(() => s[Symbol.asyncIterator]()).toThrow(NotImplementedError);
    // flow/encoding controls that the real reader implements as working no-ops
    // (former silent-success surface): MUST be loud too.
    expect(() => s.resume()).toThrow(NotImplementedError);
    expect(() => s.pause()).toThrow(NotImplementedError);
    expect(() => s.setEncoding('utf8')).toThrow(NotImplementedError);
    expect(() => s.setRawMode(true)).toThrow(NotImplementedError);
  });

  it('keeps non-data listeners + passive isTTY safe', () => {
    const proc = realSeededProcess();
    installLoudStdin(proc);
    const s = proc.stdin as LoudStdin;
    // 'end'/'close' etc. must still register (the reader's own end-handler relies on it).
    expect(() => s.on('end', () => {})).not.toThrow();
    expect(s.isTTY).toBe(false);
  });
});
