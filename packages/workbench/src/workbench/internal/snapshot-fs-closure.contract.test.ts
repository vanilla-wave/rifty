import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function staticImportSpecifiers(path: string): readonly string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function resolveRelativeSource(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const exact = resolve(dirname(importer), specifier);
  if (existsSync(exact) && statSync(exact).isFile()) return exact;
  for (const extension of ['.ts', '.tsx', '.js', '.json']) {
    const candidate = `${exact}${extension}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Unresolved relative source import ${specifier} from ${importer}`);
}

function sourceClosure(entry: string): ReadonlySet<string> {
  const pending = [entry];
  const files = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || files.has(path)) continue;
    files.add(path);
    for (const specifier of staticImportSpecifiers(path)) {
      const dependency = resolveRelativeSource(path, specifier);
      if (dependency !== null) pending.push(dependency);
    }
  }
  return files;
}

function sourceFiles(root: string): readonly string[] {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined) continue;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(child);
    }
  }
  return files;
}

function isProductionSource(path: string): boolean {
  return !/(?:\.(?:contract\.)?(?:fault\.)?test|\.test-fixture)\.[cm]?[jt]sx?$/u.test(path);
}

describe('Workbench SnapshotFs source closure', () => {
  const srcRoot = fileURLToPath(new URL('../../', import.meta.url));
  const internalEntry = resolve(srcRoot, 'workbench/internal/snapshot-fs.ts');
  const legacyEntry = resolve(srcRoot, 'glue/snapshot-fs.ts');

  it('owns the implementation and its source dependencies without App glue', () => {
    const entry = existsSync(internalEntry) ? internalEntry : legacyEntry;
    const files = [...sourceClosure(entry)].map((path) => relative(srcRoot, path)).sort();

    expect({
      entry: relative(srcRoot, entry),
      forbiddenFiles: files.filter((path) => path.startsWith('glue/')),
    }).toEqual({
      entry: 'workbench/internal/snapshot-fs.ts',
      forbiddenFiles: [],
    });
  });

  it('has no production importer of the legacy App-glue implementation', () => {
    const forbiddenImports = sourceFiles(srcRoot)
      .filter(isProductionSource)
      .flatMap((importer) =>
        staticImportSpecifiers(importer).map((specifier) => ({ importer, specifier })),
      )
      .filter(({ specifier }) => specifier.endsWith('/snapshot-fs.ts'))
      .filter(
        ({ importer, specifier }) => resolveRelativeSource(importer, specifier) !== internalEntry,
      )
      .map(({ importer, specifier }) => `${relative(srcRoot, importer)} -> ${specifier}`)
      .sort();

    expect(forbiddenImports).toEqual([]);
  });
});
