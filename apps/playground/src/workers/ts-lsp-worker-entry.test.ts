import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./ts-lsp-worker-entry.ts', import.meta.url)),
  'utf8',
);

describe('playground TS-LSP worker production entry', () => {
  it('realigns the bundle-local Buffer before booting the language service', () => {
    expect(source).toContain('installBundleLocalBuffer');
    expect(source).toMatch(/installBundleLocalBuffer\(\)/);
  });

  it('keeps the package endpoint through an explicit call', () => {
    expect(source).toMatch(
      /import\s+\{\s*bootTsLanguageServiceWorker\s*\}\s+from\s+['"]@riftydev\/ts-language-service\/worker\/entry['"]/,
    );
    expect(source).toMatch(/\bbootTsLanguageServiceWorker\(\)/);
    expect(source).not.toMatch(/\bvoid\s+bootTsLanguageServiceWorker\b/);
  });
});
