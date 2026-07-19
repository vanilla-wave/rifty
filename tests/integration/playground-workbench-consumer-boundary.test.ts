import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
});
