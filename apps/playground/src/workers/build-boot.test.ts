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

  it('passes esbuild supported feature flags through to the WASI transform', () => {
    expect(source).toContain('supported: options.supported,');
    expect(source).not.toContain('esbuild.transform.supported.');
  });
});
