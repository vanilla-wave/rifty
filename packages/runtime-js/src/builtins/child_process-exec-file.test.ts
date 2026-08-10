import { describe, expect, it } from 'vitest';
import { execFile } from './child_process.ts';

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe('child_process.execFile option boundary', () => {
  it('validates maxBuffer and timeout before allocating a child', () => {
    expect(errorCode(() => execFile('node', [], { maxBuffer: -1 }))).toBe('ERR_OUT_OF_RANGE');
    expect(errorCode(() => execFile('node', [], { timeout: 1.5 }))).toBe('ERR_OUT_OF_RANGE');
  });

  it('keeps unsupported process carriers loud', () => {
    expect(() => execFile('node', { shell: true })).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'child_process.execFile.shell',
      }) as Error,
    );
    expect(() => execFile('node', [], { signal: new AbortController().signal })).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'child_process.execFile.signal',
      }) as Error,
    );
    expect(() => execFile('node', [], { killSignal: 'SIGKILL' })).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'child_process.execFile.killSignal',
      }) as Error,
    );
  });

  it('normalizes Node SIGTERM aliases before the loud signal ceiling', () => {
    expect(() => execFile('not-a-command', [], { killSignal: 'sigterm' })).not.toThrow();
    expect(() => execFile('not-a-command', [], { killSignal: 15 })).not.toThrow();
  });

  it('accepts Node null defaults without passing null carriers into spawn', () => {
    expect(() =>
      execFile('not-a-command', [], {
        argv0: null,
        cwd: null,
        env: null,
        gid: null,
        shell: null,
        uid: null,
      } as never),
    ).not.toThrow();
    expect(errorCode(() => execFile('node', [], { signal: null } as never))).toBe(
      'ERR_INVALID_ARG_TYPE',
    );
  });
});
