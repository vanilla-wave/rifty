import { describe, expect, it } from 'vitest';
import { createEsbuildTransformBridge, splitInlineSourcemap } from './esbuild-wasi-transform.ts';

describe('esbuild WASI transform bridge', () => {
  it('returns Vite-compatible external sourcemap JSON from esbuild CLI inline output', () => {
    const map = JSON.stringify({
      version: 3,
      sources: ['main.ts'],
      sourcesContent: ['const x: number = 1;'],
      mappings: 'AAAA',
      names: [],
    });
    const encoded = btoa(map);
    const out = splitInlineSourcemap(
      `const x = 1;\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`,
    );

    expect(out.code).toBe('const x = 1;\n');
    expect(JSON.parse(out.map)).toEqual(JSON.parse(map));
  });

  it('loud-throws for unsupported esbuild transform options before running WASI', async () => {
    const bridge = createEsbuildTransformBridge('/workspace');

    await expect(
      bridge('export const x = 1;\n', {
        loader: 'ts',
        legalComments: 'external',
      } as never),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'esbuild.transform.legalComments',
    });
  });
});
