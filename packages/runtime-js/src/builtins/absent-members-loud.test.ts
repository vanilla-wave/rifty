import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import childProcess from './child_process.ts';
import fs from './fs.ts';
import { riftyProcess } from './process.ts';

describe('builtin members imported by vitest', () => {
  function expectLoudCall(call: () => unknown, feature: string): void {
    try {
      call();
      throw new Error(`Expected ${feature} to throw`);
    } catch (error) {
      expect(error).toBeInstanceOf(NotImplementedError);
      expect((error as NotImplementedError).feature).toBe(feature);
    }
  }

  it('exposes statfsSync for linking, then names its unsupported call', () => {
    expect(typeof fs.statfsSync).toBe('function');
    expectLoudCall(() => fs.statfsSync('/'), 'fs.statfsSync');
  });

  it('exposes spawnSync for linking, then names its unsupported call', () => {
    expect(typeof childProcess.spawnSync).toBe('function');
    expectLoudCall(() => childProcess.spawnSync('git', ['status']), 'child_process.spawnSync');
  });

  it('allows memoryUsage binding, then names its unsupported call', () => {
    expect(typeof riftyProcess.memoryUsage).toBe('function');
    const memoryUsage = riftyProcess.memoryUsage.bind(riftyProcess);
    expectLoudCall(memoryUsage, 'process.memoryUsage');
  });
});
