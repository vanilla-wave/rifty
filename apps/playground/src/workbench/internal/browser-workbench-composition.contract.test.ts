import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause?.isTypeOnly === true) return true;
  if (clause?.name !== undefined || clause?.namedBindings === undefined) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return false;
  return (
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function runtimeStaticImportSpecifiers(path: string): readonly string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (isTypeOnlyImport(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      specifiers.push(statement.moduleSpecifier.text);
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.isTypeOnly !== true &&
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
  if (existsSync(exact)) return exact;
  for (const extension of ['.ts', '.tsx']) {
    const candidate = `${exact}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Unresolved relative source import ${specifier} from ${importer}`);
}

function runtimeStaticClosure(entry: URL): ReadonlySet<string> {
  const pending = [fileURLToPath(entry)];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || visited.has(path)) continue;
    visited.add(path);
    for (const specifier of runtimeStaticImportSpecifiers(path)) {
      const dependency = resolveRelativeSource(path, specifier);
      if (dependency !== null) pending.push(dependency);
    }
  }
  return visited;
}

describe('browser Workbench composition closure', () => {
  it('keeps companion composition out of the generic entry and reuses generic composition', () => {
    const genericComposition = fileURLToPath(
      new URL('./browser-workbench-composition.ts', import.meta.url),
    );
    const companionComposition = fileURLToPath(
      new URL('./browser-playground-workbench-composition.ts', import.meta.url),
    );
    const companionImplementation = fileURLToPath(
      new URL('./playground-workbench.ts', import.meta.url),
    );
    const genericClosure = runtimeStaticClosure(new URL('../public.ts', import.meta.url));
    const companionClosure = runtimeStaticClosure(new URL('../playground.ts', import.meta.url));

    expect(genericClosure).toContain(genericComposition);
    expect(genericClosure).not.toContain(companionComposition);
    expect(genericClosure).not.toContain(companionImplementation);
    expect(companionClosure).toContain(genericComposition);
    expect(companionClosure).toContain(companionComposition);
    expect(companionClosure).toContain(companionImplementation);
  });
});
