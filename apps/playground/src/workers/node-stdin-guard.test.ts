import { NotImplementedError } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { installLoudStdin } from './node-stdin-guard.ts';

interface LoudStdin {
  isTTY: boolean;
  on(event: string, cb: () => void): unknown;
  read(): unknown;
  resume(): unknown;
}

describe('installLoudStdin', () => {
  it('makes consume methods throw NotImplementedError, never a silent hang', () => {
    const proc: { stdin?: unknown } = { stdin: {} };
    installLoudStdin(proc);
    const stdin = proc.stdin as LoudStdin;
    expect(() => stdin.on('data', () => {})).toThrow(NotImplementedError);
    expect(() => stdin.read()).toThrow(/process\.stdin/);
    expect(() => stdin.resume()).toThrow(NotImplementedError);
  });

  it('keeps passive reads safe (no throw on isTTY)', () => {
    const proc: { stdin?: unknown } = { stdin: {} };
    installLoudStdin(proc);
    expect((proc.stdin as LoudStdin).isTTY).toBe(false);
  });
});
