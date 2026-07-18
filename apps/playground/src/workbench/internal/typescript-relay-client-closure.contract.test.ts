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

describe('Workbench TypeScript relay source closure', () => {
  it('keeps correlation internal while Monaco remains App-only', () => {
    const srcRoot = fileURLToPath(new URL('../../', import.meta.url));
    const closure = sourceClosure(
      new URL('./playground-session-tools-transport.ts', import.meta.url),
    );
    const files = [...closure.files].map((path) => relative(srcRoot, path)).sort();
    const forbiddenFiles = files.filter(
      (path) =>
        path.startsWith('adapters/') ||
        path.startsWith('components/') ||
        /^glue\/ts-ls-(?:client|request-id|monaco)/u.test(path),
    );
    const forbiddenBareSpecifiers = [...closure.bareSpecifiers]
      .filter(
        (specifier) => specifier === 'monaco-editor' || specifier === 'solid-js',
      )
      .sort();

    expect({
      hasInternalRelayClient: files.includes('workbench/internal/typescript-relay-client.ts'),
      forbiddenFiles,
      forbiddenBareSpecifiers,
    }).toEqual({
      hasInternalRelayClient: true,
      forbiddenFiles: [],
      forbiddenBareSpecifiers: [],
    });
  });

  it('types App Monaco providers against the public companion interface', () => {
    const providerPath = fileURLToPath(
      new URL('../../glue/ts-ls-monaco-providers.ts', import.meta.url),
    );
    const imports = staticImportSpecifiers(providerPath);

    expect(imports).toContain('../workbench/playground.ts');
    expect(imports.some((specifier) => specifier.includes('ts-ls-client'))).toBe(false);
    expect(imports.some((specifier) => specifier.includes('/internal/'))).toBe(false);
  });
});
