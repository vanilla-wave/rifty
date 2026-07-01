import { describe, expect, it, vi } from 'vitest';
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

  it('compiles the binary once per realm and instantiates a fresh instance per transform', async () => {
    // (module (func (export "_start"))) — stands in for esbuild.wasm; the
    // bridge only needs runWasi to complete with exit 0 / empty stdout.
    const TRIVIAL_WASI_START = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03,
      0x02, 0x01, 0x00, 0x07, 0x0a, 0x01, 0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x00,
      0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
    ]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(TRIVIAL_WASI_START.slice().buffer));
    const compileSpy = vi.spyOn(WebAssembly, 'compile');
    const instantiateSpy = vi.spyOn(WebAssembly, 'instantiate');
    try {
      const bridge = createEsbuildTransformBridge('/workspace');
      await bridge('const a = 1;');
      await bridge('const b = 2;');
      expect(compileSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // Every run instantiates from the cached Module — never re-compiles bytes.
      expect(instantiateSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      for (const call of instantiateSpy.mock.calls) {
        expect(call[0]).toBeInstanceOf(WebAssembly.Module);
      }
    } finally {
      fetchSpy.mockRestore();
      compileSpy.mockRestore();
      instantiateSpy.mockRestore();
    }
  });
});
