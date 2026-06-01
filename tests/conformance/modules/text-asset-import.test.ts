import { createModuleLoader } from '@rifty/runtime-js/loader';
import { MemoryFsSync } from '@rifty/vfs/internal';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>) {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

// ADR-0067: `.txt`/`.sql`/`.md`/`.prompt` import as TEXT — the default export is
// the raw file contents (esbuild/Bun text-loader). opencode imports prompt `.txt`
// files this way (`agent/agent.ts`: `import PROMPT from "./generate.txt"`).
describe('text-asset imports (ADR-0067)', () => {
  it('ESM default import of a .txt is the file contents', async () => {
    const loader = setup({
      '/app/prompt.txt': 'You are a helpful agent.\nBe concise.',
      '/app/main.mjs': 'import PROMPT from "./prompt.txt"; export const out = PROMPT;',
    });
    const ns = await loader.import('/app/main.mjs', '/app/__entry__.mjs');
    expect(ns.out).toBe('You are a helpful agent.\nBe concise.');
  });

  it('CJS require of a .txt returns the contents string', () => {
    const loader = setup({ '/app/x.txt': 'raw text body' });
    expect(loader.require('./x.txt', '/app/main.js')).toBe('raw text body');
  });

  it('.sql / .md / .prompt also import as text', async () => {
    const loader = setup({
      '/app/schema.sql': 'CREATE TABLE t (id TEXT);',
      '/app/doc.md': '# Title\n\nbody',
      '/app/p.prompt': 'system prompt',
      '/app/main.mjs':
        'import sql from "./schema.sql";\nimport md from "./doc.md";\nimport p from "./p.prompt";\n' +
        'export const out = [sql, md, p];',
    });
    const ns = await loader.import('/app/main.mjs', '/app/__entry__.mjs');
    expect(ns.out).toEqual(['CREATE TABLE t (id TEXT);', '# Title\n\nbody', 'system prompt']);
  });

  it('a bare extensionless specifier does NOT resolve to a .txt (Node-faithful)', () => {
    const loader = setup({ '/app/data.txt': 'nope' });
    expect(() => loader.require('./data', '/app/main.js')).toThrow(/Cannot find module/);
  });
});
