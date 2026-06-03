import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>) {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

// ADR-0068: `import x from "spec" with { type: "file" }` (esbuild/Bun file loader)
// binds the local to the asset's resolved absolute PATH — the asset is NOT loaded
// or evaluated as a module (it may be binary). opencode imports its photon wasm
// path this way (`image/image.ts`). The asset content here is deliberately invalid
// JS to prove it is never executed.
describe('file-loader import attribute (ADR-0068)', () => {
  it('default import with { type: "file" } binds the resolved path', async () => {
    const loader = setup({
      '/app/asset.wasm': '\0\0this is not valid javascript @#$%',
      '/app/main.mjs': 'import p from "./asset.wasm" with { type: "file" }; export const out = p;',
    });
    const ns = await loader.import('/app/main.mjs', '/app/__entry__.mjs');
    expect(ns.out).toBe('/app/asset.wasm');
  });

  it('namespace import with { type: "file" } binds { default: path }', async () => {
    const loader = setup({
      '/app/blob.bin': 'not js',
      '/app/main.mjs':
        'import * as p from "./blob.bin" with { type: "file" }; export const out = p.default;',
    });
    const ns = await loader.import('/app/main.mjs', '/app/__entry__.mjs');
    expect(ns.out).toBe('/app/blob.bin');
  });

  it('the asset is resolvable as a bare package subpath', async () => {
    const loader = setup({
      '/proj/node_modules/pkg/data.wasm': '\0binary',
      '/proj/node_modules/pkg/package.json': '{"name":"pkg"}',
      '/proj/main.mjs':
        'import p from "pkg/data.wasm" with { type: "file" }; export const out = p;',
    });
    const ns = await loader.import('/proj/main.mjs', '/proj/__entry__.mjs');
    expect(ns.out).toBe('/proj/node_modules/pkg/data.wasm');
  });
});
