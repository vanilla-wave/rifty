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

  it('installs the host esbuild-wasm bridge before Vite imports esbuild (ADR-0192)', () => {
    expect(source).toContain("import { installEsbuildBridge } from './esbuild-host.ts'");
    expect(source.indexOf('installEsbuildBridge()')).toBeLessThan(
      source.indexOf("loader.import('vite'"),
    );
    // Preview overlays the shim too, so it must install the bridge as well.
    expect(source.split('installEsbuildBridge()').length - 1).toBe(2);
  });

  it('loud-rejects user vite.config files before curated build/preview can ignore them', () => {
    expect(source).toContain("import { assertNoUserViteConfig } from './vite-config-guard.ts'");
    expect(source.split('assertNoUserViteConfig(root)').length - 1).toBe(2);
  });
});
