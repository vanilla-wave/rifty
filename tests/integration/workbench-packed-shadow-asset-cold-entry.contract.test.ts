import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/workbench-vite-consumer');

function staticImports(source: string, fileName: string): readonly string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return imports.sort();
}

describe('packed shadow-asset cold entry contract', () => {
  it('is a separate production HTML entry instead of loading the acceptance main graph', async () => {
    const html = await readFile(resolve(fixtureRoot, 'shadow-asset-cold.html'), 'utf8');

    expect(html).toContain('/src/shadow-asset-cold-entry.ts');
    expect(html).not.toContain('/src/main.ts');
  });

  it('exposes only the dedicated measurement module from its entry', async () => {
    const entryPath = resolve(fixtureRoot, 'src/shadow-asset-cold-entry.ts');
    const source = await readFile(entryPath, 'utf8');

    expect(staticImports(source, entryPath)).toEqual(['./shadow-asset-cold']);
    expect(source).toContain('__RIFTY_SHADOW_ASSET_COLD__');
    expect(source).not.toContain('__RIFTY_PACKED_WORKBENCH__');
  });

  it('imports only its pure options helper plus public runtime paths', async () => {
    const modulePath = resolve(fixtureRoot, 'src/shadow-asset-cold.ts');
    const source = await readFile(modulePath, 'utf8');

    expect(staticImports(source, modulePath)).toEqual([
      './shadow-asset-cold-options',
      '@riftydev/service-worker/sw?worker&url',
      '@riftydev/workbench',
      '@riftydev/workbench/dev-server-worker?worker&url',
      '@riftydev/workbench/kernel-worker?worker&url',
      '@riftydev/workbench/node-worker?worker&url',
      '@riftydev/workbench/owner-worker?worker&url',
      'sql.js/dist/sql-wasm.wasm?url',
    ]);
    expect(source).not.toContain('@riftydev/workbench/playground');
    expect(source).not.toContain('typescript-worker');

    const optionsPath = resolve(fixtureRoot, 'src/shadow-asset-cold-options.ts');
    expect(staticImports(await readFile(optionsPath, 'utf8'), optionsPath)).toEqual([]);
  });
});
