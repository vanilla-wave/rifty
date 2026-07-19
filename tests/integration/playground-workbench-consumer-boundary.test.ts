import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function staticImportSpecifiers(path: string): readonly string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements.flatMap((statement) => {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
}

function productionSources(root: string): readonly string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.[jt]sx?$/u.test(entry.name) &&
        !/(?:\.(?:contract\.)?(?:fault\.)?test|\.test-fixture)\.[cm]?[jt]sx?$/u.test(entry.name),
    )
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
}

function importsNamedBinding(path: string, specifier: string, binding: string): boolean {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== specifier
    ) {
      return false;
    }
    const bindings = statement.importClause?.namedBindings;
    return (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => (element.propertyName ?? element.name).text === binding)
    );
  });
}

describe('Playground consumes the sealed Workbench boundary', () => {
  it('types Monaco providers against the public companion interface', () => {
    const imports = staticImportSpecifiers(
      resolve('apps/playground/src/glue/ts-ls-monaco-providers.ts'),
    );

    expect(imports).toContain('@riftydev/workbench/playground');
    expect(imports.some((specifier) => specifier.includes('ts-ls-client'))).toBe(false);
    expect(imports.some((specifier) => specifier.includes('/internal/'))).toBe(false);
  });

  it('keeps ScmResourceRow presentation in the App diff planner', () => {
    const imports = staticImportSpecifiers(resolve('apps/playground/src/glue/scm-diff-plan.ts'));

    expect(imports).toContain('./scm-status.ts');
    expect(imports.some((specifier) => specifier.includes('/workbench/'))).toBe(false);
  });

  it('keeps raw Node runtime configuration out of normal Playground production', () => {
    const appRoot = resolve('apps/playground/src');
    const owners = productionSources(appRoot)
      .filter(
        (path) =>
          importsNamedBinding(path, '@riftydev/kernel', 'setKernelWorkerUrl') ||
          importsNamedBinding(
            path,
            '@riftydev/runtime-js/builtins/node-entry-url',
            'configureNodeEntryWorker',
          ),
      )
      .map((path) => relative(appRoot, path));

    expect(existsSync(resolve(appRoot, 'glue/playground-node-worker-runtime.ts'))).toBe(false);
    expect(owners).toEqual(['execsync-harness.ts', 'workers/execsync-harness-guest.ts']);
    expect(readFileSync(resolve(appRoot, '../unit-harness.html'), 'utf8')).not.toContain(
      'playground-node-worker-runtime',
    );
  });
});
