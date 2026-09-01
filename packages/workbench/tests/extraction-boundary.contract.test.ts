import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Loader, build, transform } from 'esbuild';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { EXTRACTION_MAP } from './extraction-map.ts';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const APP_SRC_ROOT = resolve(REPO_ROOT, 'apps/playground/src');
const PACKAGE_SRC_ROOT = resolve(PACKAGE_ROOT, 'src');

const EXPORTED_SOURCE_ENTRIES = [
  'src/index.ts',
  'src/workbench/playground.ts',
  'src/workers/workbench-owner-bootstrap.ts',
  'src/workers/kernel-worker-entry.ts',
  'src/workers/node-entry-bootstrap.ts',
  'src/workers/dev-server-child-bootstrap.ts',
  'src/workers/ts-lsp-worker-entry.ts',
  'src/workers/no-coi-toolchain-worker.ts',
] as const;

const EXPECTED_EXTERNAL_PACKAGES = [
  '@riftydev/git',
  '@riftydev/io',
  '@riftydev/kernel',
  '@riftydev/net',
  '@riftydev/npm-client',
  '@riftydev/runtime-js',
  '@riftydev/service-worker',
  '@riftydev/shell',
  '@riftydev/ts-language-service',
  '@riftydev/vfs',
] as const;

interface PackageManifest {
  readonly exports: Readonly<Record<string, string>>;
  readonly dependencies: Readonly<Record<string, string>>;
}

interface ModuleReference {
  readonly importer: string;
  readonly specifier: string;
  readonly isStatic: boolean;
}

interface ClosureAudit {
  readonly files: ReadonlySet<string>;
  readonly externalPackages: ReadonlySet<string>;
  readonly escapedEdges: readonly string[];
  readonly unresolvedEdges: readonly string[];
  readonly allReferences: readonly ModuleReference[];
  readonly importMetaEnvFiles: readonly string[];
}

function isProductionSource(path: string): boolean {
  return (
    /\.(?:[cm]?[jt]sx?|json)$/u.test(path) &&
    !/[\\/]test-fixtures[\\/]/u.test(path) &&
    !/(?:\.(?:contract\.)?(?:fault\.)?test|\.test-fixture)\.[cm]?[jt]sx?$/u.test(path)
  );
}

function readManifest(): PackageManifest {
  return JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as PackageManifest;
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0] ?? specifier;
}

function moduleReferences(path: string, sourceText: string): readonly ModuleReference[] {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const references: ModuleReference[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      references.push({ importer: path, specifier: node.moduleSpecifier.text, isStatic: true });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (node.arguments.length === 1 && argument !== undefined && ts.isStringLiteral(argument)) {
        references.push({ importer: path, specifier: argument.text, isStatic: false });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return references;
}

function usesImportMetaEnv(path: string, sourceText: string): boolean {
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  let found = false;

  function isImportMeta(node: ts.Node): boolean {
    return (
      ts.isMetaProperty(node) &&
      node.keywordToken === ts.SyntaxKind.ImportKeyword &&
      node.name.text === 'meta'
    );
  }

  function visit(node: ts.Node): void {
    if (
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === 'env' &&
        isImportMeta(node.expression)) ||
      (ts.isElementAccessExpression(node) &&
        node.argumentExpression !== undefined &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === 'env' &&
        isImportMeta(node.expression))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return found;
}

function relativeSource(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.json`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.tsx'),
    resolve(base, 'index.js'),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? base
  );
}

function isOutsidePackage(path: string): boolean {
  const fromPackage = relative(PACKAGE_ROOT, path);
  return (
    fromPackage === '..' ||
    fromPackage.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(fromPackage)
  );
}

function sourceClosure(entries: readonly string[]): ClosureAudit {
  const pending = [...entries];
  const files = new Set<string>();
  const externalPackages = new Set<string>();
  const escapedEdges: string[] = [];
  const unresolvedEdges: string[] = [];
  const allReferences: ModuleReference[] = [];
  const importMetaEnvFiles: string[] = [];

  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || files.has(path)) continue;
    files.add(path);
    const sourceText = readFileSync(path, 'utf8');
    if (usesImportMetaEnv(path, sourceText)) importMetaEnvFiles.push(relative(PACKAGE_ROOT, path));

    const references = moduleReferences(path, sourceText);
    allReferences.push(...references);
    for (const reference of references) {
      if (!reference.isStatic) continue;
      const dependency = relativeSource(path, reference.specifier);
      if (dependency === null) {
        externalPackages.add(packageName(reference.specifier));
        continue;
      }
      const edge = `${relative(PACKAGE_ROOT, path)} -> ${reference.specifier}`;
      if (isOutsidePackage(dependency)) {
        escapedEdges.push(edge);
      } else if (!existsSync(dependency) || !statSync(dependency).isFile()) {
        unresolvedEdges.push(edge);
      } else {
        pending.push(dependency);
      }
    }
  }

  return {
    files,
    externalPackages,
    escapedEdges: escapedEdges.sort(),
    unresolvedEdges: unresolvedEdges.sort(),
    allReferences,
    importMetaEnvFiles: importMetaEnvFiles.sort(),
  };
}

function productionFiles(root: string): readonly string[] {
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined) continue;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile() && isProductionSource(child)) files.push(child);
    }
  }
  return files.sort();
}

function resolvedExportEntries(): readonly string[] {
  return Object.values(readManifest().exports).map((target) => resolve(PACKAGE_ROOT, target));
}

function sourceLoader(path: string): Loader {
  switch (extname(path)) {
    case '.ts':
    case '.mts':
    case '.cts':
      return 'ts';
    case '.tsx':
      return 'tsx';
    case '.jsx':
      return 'jsx';
    case '.json':
      return 'json';
    default:
      return 'js';
  }
}

async function runtimeBearingSourcesOutsideBuild(): Promise<readonly string[]> {
  const manifest = readManifest();
  const result = await build({
    absWorkingDir: PACKAGE_ROOT,
    entryPoints: resolvedExportEntries(),
    bundle: true,
    external: Object.keys(manifest.dependencies).flatMap((dependency) => [
      dependency,
      `${dependency}/*`,
    ]),
    format: 'esm',
    logLevel: 'silent',
    metafile: true,
    outdir: resolve(PACKAGE_ROOT, '.runtime-reachability-output'),
    platform: 'browser',
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
  const runtimeInputs = new Set(
    Object.keys(result.metafile.inputs).map((path) => resolve(PACKAGE_ROOT, path)),
  );
  const outsideBuild = productionFiles(PACKAGE_SRC_ROOT).filter((path) => !runtimeInputs.has(path));
  const emitted = await Promise.all(
    outsideBuild.map(async (path) => ({
      path,
      code: (
        await transform(readFileSync(path, 'utf8'), {
          format: 'esm',
          loader: sourceLoader(path),
          target: 'es2022',
          treeShaking: true,
        })
      ).code,
    })),
  );
  return emitted
    .filter(({ code }) => code.trim().length > 0)
    .map(({ path }) => relative(PACKAGE_ROOT, path))
    .sort();
}

describe('@riftydev/workbench extraction boundary', () => {
  it('pins the retained 224-file move, including all 107 tests and three fixtures', () => {
    expect(EXTRACTION_MAP).toHaveLength(224);
    expect(new Set(EXTRACTION_MAP.map(([source]) => source)).size).toBe(224);
    expect(new Set(EXTRACTION_MAP.map(([, target]) => target)).size).toBe(224);
    expect(
      EXTRACTION_MAP.filter(([, target]) =>
        /(?:[\\/]test-fixtures[\\/]|(?:\.(?:contract\.)?(?:fault\.)?test|\.test-fixture)\.[cm]?[jt]sx?$)/u.test(
          target,
        ),
      ),
    ).toHaveLength(110);

    expect(
      EXTRACTION_MAP.filter(([source]) => existsSync(resolve(APP_SRC_ROOT, source))).map(
        ([source]) => source,
      ),
    ).toEqual([]);
    expect(
      EXTRACTION_MAP.filter(([, target]) => !existsSync(resolve(PACKAGE_SRC_ROOT, target))).map(
        ([, target]) => target,
      ),
    ).toEqual([]);
  });

  it('resolves exactly the eight sealed package source entries', () => {
    const entries = resolvedExportEntries();
    expect(entries.map((path) => relative(PACKAGE_ROOT, path))).toEqual(EXPORTED_SOURCE_ENTRIES);
    expect(
      entries.filter((path) => !existsSync(path)).map((path) => relative(PACKAGE_ROOT, path)),
    ).toEqual([]);
    expect(entries.filter(isOutsidePackage)).toEqual([]);
  });

  it('contains the whole production closure with no unreachable implementation files', () => {
    const entries = resolvedExportEntries();
    const closure = sourceClosure(entries);
    const packageProductionFiles = productionFiles(PACKAGE_SRC_ROOT);

    expect(closure.escapedEdges).toEqual([]);
    expect(closure.unresolvedEdges).toEqual([]);
    // 136 → 139 (2026-08-16, #256 first-open unit): file-size-ratchet splits
    // riding the delivery — owner-protocol-inspect.ts + owner-protocol-pty.ts
    // (owner-protocol.ts was pushed past 800) and
    // workbench-browser-owner-spawn.ts (browser owner sat at its exact pin).
    // 139 → 140 (2026-08-19, #255 silence deadline): same ratchet, same
    // reason — open-workbench.ts sat at its exact pin, so the one options
    // validation authority moved to internal/workbench-options.ts.
    // 140 → 141 (2026-08-19, #247 item 5): emnapi install policy.
    // 141 → 143 (2026-08-24, ADR-0362): PTY pending-authority file-size split
    // and the owner-only `.bin` path classifier.
    // 143 → 142 (2026-08-31, ADR-0371): delete the N=1 owner asset authority.
    // 142 → 143 (2026-09-01, ADR-0375): public no-COI toolchain Worker.
    // 143 → 145 (2026-09-01, ADR-0375): generic finalizer + bounded gap provenance.
    // 145 → 144 (2026-09-01, ADR-0375): bounded gap helper moved to runtime-js.
    expect(packageProductionFiles).toHaveLength(144);
    expect([...closure.files].sort()).toEqual(packageProductionFiles);
  });

  it('does not retain runtime-bearing source outside the eight published build entries', async () => {
    expect(await runtimeBearingSourcesOutsideBuild()).toEqual([]);
  });

  it('imports only declared lower packages and no App, bundler query, env, Solid, or Monaco code', () => {
    const closure = sourceClosure(resolvedExportEntries());
    const references = closure.allReferences;

    expect([...closure.externalPackages].sort()).toEqual(EXPECTED_EXTERNAL_PACKAGES);
    expect(Object.keys(readManifest().dependencies).sort()).toEqual(EXPECTED_EXTERNAL_PACKAGES);
    expect(
      references
        .filter(
          ({ specifier }) =>
            specifier.includes('apps/playground') || specifier.startsWith('@riftydev/playground'),
        )
        .map(({ importer, specifier }) => `${relative(PACKAGE_ROOT, importer)} -> ${specifier}`),
    ).toEqual([]);
    expect(references.filter(({ specifier }) => specifier.includes('?'))).toEqual([]);
    expect(closure.importMetaEnvFiles).toEqual([]);
    expect(
      references.filter(({ specifier }) => {
        const dependency = packageName(specifier);
        return dependency === 'solid-js' || dependency === 'monaco-editor';
      }),
    ).toEqual([]);
  });
});
