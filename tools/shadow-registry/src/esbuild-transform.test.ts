import { describe, expect, it } from 'vitest';
import { type RunWasi, transformWithEsbuild } from './esbuild-transform.ts';

describe('transformWithEsbuild', () => {
  it('forwards every esbuild supported feature flag to the WASI CLI', async () => {
    let args: readonly string[] = [];
    const runWasi: RunWasi = async (_wasm, opts) => {
      args = opts.args ?? [];
      return { exitCode: 0, stdout: 'export const ok = true;\n', stderr: '' };
    };

    await transformWithEsbuild(runWasi, new Uint8Array(), {
      source: 'export const ok = import.meta.url;\n',
      loader: 'js',
      supported: { decorators: false, 'dynamic-import': true },
    });

    expect(args).toContain('--supported:decorators=false');
    expect(args).toContain('--supported:dynamic-import=true');
  });
});
