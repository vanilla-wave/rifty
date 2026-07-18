import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface SourceClosure {
  readonly files: ReadonlySet<string>;
  readonly bareSpecifiers: ReadonlySet<string>;
}

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

function sourceClosure(entry: URL): SourceClosure {
  const pending = [fileURLToPath(entry)];
  const files = new Set<string>();
  const bareSpecifiers = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || files.has(path)) continue;
    files.add(path);
    for (const specifier of staticImportSpecifiers(path)) {
      const dependency = resolveRelativeSource(path, specifier);
      if (dependency === null) bareSpecifiers.add(specifier);
      else pending.push(dependency);
    }
  }
  return { files, bareSpecifiers };
}

describe('Workbench SCM source closure', () => {
  it('keeps App SCM rows and their diff-plan adapter outside Workbench semantics', () => {
    const srcRoot = fileURLToPath(new URL('../../', import.meta.url));
    const closure = sourceClosure(new URL('./playground-scm.ts', import.meta.url));
    const files = [...closure.files].map((path) => relative(srcRoot, path)).sort();
    const appScmFiles = files.filter(
      (path) => path === 'glue/scm-diff-plan.ts' || path === 'glue/scm-status.ts',
    );

    expect({
      entry: files.includes('workbench/internal/playground-scm.ts'),
      appScmFiles,
    }).toEqual({
      entry: true,
      appScmFiles: [],
    });
  });

  it('retains the ScmResourceRow mapping in the App diff planner', () => {
    const plannerPath = fileURLToPath(new URL('../../glue/scm-diff-plan.ts', import.meta.url));

    expect(staticImportSpecifiers(plannerPath)).toContain('./scm-status.ts');
  });
});
