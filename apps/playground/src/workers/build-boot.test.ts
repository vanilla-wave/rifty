import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./build-boot.ts', import.meta.url)), 'utf8');

describe('Vite build/preview boot', () => {
  it('carries zero shim glue — internals shims are applied at install time (ADR-0188)', () => {
    expect(source).not.toContain('overlayBuildShims');
    expect(source).not.toContain('reRootBuildShimPath');
    expect(source).not.toContain('ShimFiles');
  });

  it('uses Vite default absolute base and rejects malformed .assets paths', () => {
    expect(source).toContain("base: '/'");
    expect(source).toContain("html.includes('.assets/')");
  });

  it('installs the shared esbuild WASI transform bridge before Vite imports esbuild', () => {
    expect(source).toContain(
      "import { installEsbuildTransformBridge } from './esbuild-wasi-transform.ts'",
    );
    expect(source.indexOf('installEsbuildTransformBridge(root)')).toBeLessThan(
      source.indexOf("loader.import('vite'"),
    );
  });

  it('loud-rejects user vite.config files before curated build/preview can ignore them', () => {
    expect(source).toContain("import { assertNoUserViteConfig } from './vite-config-guard.ts'");
    expect(source.split('assertNoUserViteConfig(root)').length - 1).toBe(2);
  });
});
