import { describe, expect, it } from 'vitest';
import { assertRollupWasmNodeLockstep } from './rollup-lockstep.ts';

const lockfile = (versions: Record<string, string>) => ({
  packages: Object.fromEntries(
    Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }]),
  ),
});

describe('assertRollupWasmNodeLockstep', () => {
  it('accepts a vite snapshot whose rollup and @rollup/wasm-node versions match', () => {
    expect(() =>
      assertRollupWasmNodeLockstep(
        'vite',
        lockfile({ rollup: '4.62.2', '@rollup/wasm-node': '4.62.2' }),
      ),
    ).not.toThrow();
  });

  it('throws loudly when the wasm parser drifts from rollup', () => {
    expect(() =>
      assertRollupWasmNodeLockstep(
        'vite',
        lockfile({ rollup: '4.62.3', '@rollup/wasm-node': '4.62.2' }),
      ),
    ).toThrow(/vite.*rollup.*4\.62\.3.*@rollup\/wasm-node.*4\.62\.2/s);
  });
});
