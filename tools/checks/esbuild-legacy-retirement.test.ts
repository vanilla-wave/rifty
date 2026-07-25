import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RETIRED_ESBUILD_PATHS,
  RETIRED_ESBUILD_REFERENCES,
  evaluateEsbuildLegacyRetirement,
} from './esbuild-legacy-retirement.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('esbuild legacy retirement', () => {
  it('keeps the deletion inventory finite', () => {
    expect(RETIRED_ESBUILD_PATHS).toEqual([
      'tests/integration/esbuild-wasi-transform.test.ts',
      'tools/shadow-registry/scripts/fetch-esbuild-wasi.mjs',
      'tools/shadow-registry/src/esbuild-binding.ts',
      'tools/shadow-registry/src/esbuild-transform.test.ts',
      'tools/shadow-registry/src/esbuild-transform.ts',
      'tools/shadow-registry/vendor/esbuild-wasi-preview1/esbuild.wasm',
    ]);
    expect(RETIRED_ESBUILD_REFERENCES).toEqual([
      '@riftydev/shadow-registry/esbuild-binding',
      '@riftydev/shadow-registry/esbuild-transform',
      'ESBUILD_WASM_VENDOR_PATH',
      'loadVendoredEsbuildWasm',
      'fetch-esbuild-wasi.mjs',
    ]);
  });

  it('keeps every vendored-WASI path and consumer deleted', () => {
    expect(evaluateEsbuildLegacyRetirement(ROOT)).toEqual([]);
  });

  it('reports both a retired path and a surviving consumer reference', () => {
    expect(
      evaluateEsbuildLegacyRetirement(
        '/repo',
        ['tools/shadow-registry/src/esbuild-binding.ts', 'consumer.ts'],
        {
          pathExists: (path) => path === 'tools/shadow-registry/src/esbuild-binding.ts',
          readTracked: (path) =>
            path === 'consumer.ts' ? 'loadVendoredEsbuildWasm();' : 'export {};',
        },
      ),
    ).toEqual([
      'tools/shadow-registry/src/esbuild-binding.ts: retired path still exists',
      'consumer.ts: retired reference "loadVendoredEsbuildWasm"',
    ]);
  });

  it('rejects the deleted public transform subpath', () => {
    expect(
      evaluateEsbuildLegacyRetirement('/repo', ['consumer.ts'], {
        pathExists: () => false,
        readTracked: () =>
          "import { transformWithEsbuildWasi } from '@riftydev/shadow-registry/esbuild-transform';",
      }),
    ).toEqual(['consumer.ts: retired reference "@riftydev/shadow-registry/esbuild-transform"']);
  });
});
