/**
 * Named-loud members (I6): `fs.statfsSync`, `child_process.spawnSync`,
 * `process.memoryUsage` exist as real exported functions so named imports
 * link and `typeof`/`bind` introspection behave — but a CALL throws
 * `NotImplementedError('<area>.<feature>')`. No fabricated return values
 * (AGENTS.md §Fidelity): the browser realm cannot supply volume statistics
 * or process-faithful heap numbers, and an honest no-shell spawnSync needs a
 * sync handler + Node's full result shape the claimed vitest path never
 * calls. The call-time divergence vs Node is the declared compat ❌.
 */
import { describe, expect, it } from 'vitest';
import fs from './fs.ts';
import cp from './child_process.ts';
import proc from './process.ts';

/** Exact feature pin: a substring message match would let
 * `NotImplementedError('<feature>.wrong')` pass — only `.feature` is exact.
 * Duck-typed on `name`: `@riftydev/vfs` and `@riftydev/io` each carry their
 * own NotImplementedError class (vfs is the lower layer), and process.ts
 * throws the vfs one — `instanceof` against either single class would lie. */
function thrownFeature(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof Error) || err.name !== 'NotImplementedError') {
      throw new Error(`expected a NotImplementedError, got ${String(err)}`);
    }
    return (err as unknown as { feature: string }).feature;
  }
  throw new Error('expected a NotImplementedError, nothing was thrown');
}

describe('named-loud builtin members', () => {
  it('fs.statfsSync is a function whose CALL throws NotImplementedError', () => {
    expect(typeof fs.statfsSync).toBe('function');
    expect(fs.statfsSync.length).toBe(1);
    expect(thrownFeature(() => fs.statfsSync('/'))).toBe('fs.statfsSync');
  });

  it('child_process.spawnSync is a function whose CALL throws NotImplementedError', () => {
    expect(typeof cp.spawnSync).toBe('function');
    expect(cp.spawnSync.length).toBe(3);
    expect(thrownFeature(() => cp.spawnSync('git', ['status']))).toBe(
      'child_process.spawnSync',
    );
  });

  it('process.memoryUsage binds like the vitest worker-init shape and throws on CALL', () => {
    expect(typeof proc.memoryUsage).toBe('function');
    expect(proc.memoryUsage.length).toBe(0);
    const bound = proc.memoryUsage.bind(proc);
    expect(typeof bound).toBe('function');
    expect(thrownFeature(() => proc.memoryUsage())).toBe('process.memoryUsage');
    expect(thrownFeature(() => bound())).toBe('process.memoryUsage');
  });
});
