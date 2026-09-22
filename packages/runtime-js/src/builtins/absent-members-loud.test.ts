import { NotImplementedError } from '@riftydev/io';
import { describe, expect, it } from 'vitest';
import childProcess from './child_process.ts';
import fs from './fs.ts';
import { riftyProcess } from './process.ts';

describe('builtin members imported by vitest', () => {
  it('exposes statfsSync for linking, then names its unsupported call', () => {
    expect(typeof fs.statfsSync).toBe('function');
    expect(() => fs.statfsSync('/')).toThrow(new NotImplementedError('fs.statfsSync'));
  });

  it('exposes spawnSync for linking, then names its unsupported call', () => {
    expect(typeof childProcess.spawnSync).toBe('function');
    expect(() => childProcess.spawnSync('git', ['status'])).toThrow(
      new NotImplementedError('child_process.spawnSync'),
    );
  });

  it('allows memoryUsage binding, then names its unsupported call', () => {
    expect(typeof riftyProcess.memoryUsage).toBe('function');
    const memoryUsage = riftyProcess.memoryUsage.bind(riftyProcess);
    expect(memoryUsage).toThrow(new NotImplementedError('process.memoryUsage'));
  });
});
