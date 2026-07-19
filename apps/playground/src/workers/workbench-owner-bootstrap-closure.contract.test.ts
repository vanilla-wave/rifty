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

describe('Workbench owner bootstrap source closure', () => {
  it('resolves Git commit identity without the legacy App RPC port closure', () => {
    const srcRoot = fileURLToPath(new URL('../', import.meta.url));
    const closure = sourceClosure(new URL('./workbench-owner-bootstrap.ts', import.meta.url));
    const files = [...closure.files].map((path) => relative(srcRoot, path)).sort();
    const legacyGitPortFiles = files.filter((path) => path === 'glue/git-owner-port.ts');

    expect({
      hasOwnerIdentityResolver: files.includes('workers/owner-git-commit-identity.ts'),
      legacyGitPortFiles,
    }).toEqual({
      hasOwnerIdentityResolver: true,
      legacyGitPortFiles: [],
    });
  });

  it('uses the framework-free Git baseline without importing Playground seed policy', () => {
    const srcRoot = fileURLToPath(new URL('../', import.meta.url));
    const closure = sourceClosure(new URL('./workbench-owner-bootstrap.ts', import.meta.url));
    const files = [...closure.files].map((path) => relative(srcRoot, path)).sort();

    expect(files).toContain('glue/git-initial-baseline.ts');
    expect(files).not.toContain('glue/starter.ts');
    expect(files).not.toContain('presets.ts');
    expect(files).not.toContain('components/icons.tsx');
    expect(files).not.toContain('glue/fonts.ts');
    expect(files.some((path) => path.startsWith('templates/'))).toBe(false);
    expect(
      [...closure.bareSpecifiers].filter(
        (specifier) => specifier === 'solid-js' || specifier.startsWith('@riftydev/terminal'),
      ),
    ).toEqual([]);
  });

  it('receives package-acquisition configuration explicitly without ambient App env', () => {
    const closure = sourceClosure(new URL('./workbench-owner-bootstrap.ts', import.meta.url));
    const ambientPackageConfigSources = [...closure.files]
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return (
          source.includes('import.meta.env.VITE_RIFTY_REGISTRY_URL') ||
          source.includes('getRegistryBaseUrl') ||
          source.includes('import.meta.env.VITE_RIFTY_RESOLVER_URL') ||
          source.includes('import.meta.env.VITE_RIFTY_EDDY_BUNDLE_URL') ||
          source.includes('import.meta.env.VITE_RIFTY_EDDY_PINS') ||
          source.includes('getResolverUrl') ||
          source.includes('getEddyBundleBaseUrl') ||
          source.includes('getEddyPin')
        );
      })
      .map((path) => relative(fileURLToPath(new URL('../', import.meta.url)), path))
      .sort();
    expect(ambientPackageConfigSources).toEqual([]);
  });
});
