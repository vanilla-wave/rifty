import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./build-boot.ts', import.meta.url)), 'utf8');

describe('Vite build/preview shim overlay', () => {
  it('re-roots build shims onto the active project root', () => {
    expect(source).toContain('function overlayBuildShims(root: string): void');
    expect(source).toContain('reRootBuildShimPath(path, root)');
    expect(source).toContain('overlayBuildShims(root)');
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
