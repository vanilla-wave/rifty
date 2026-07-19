import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const APP_SRC_ROOT = resolve(REPO_ROOT, 'apps/playground/src');

const EXPORTED_SOURCE_ENTRIES = [
  'src/workbench/public.ts',
  'src/workbench/playground.ts',
  'src/workers/workbench-owner-bootstrap.ts',
  'src/workers/kernel-worker-entry.ts',
  'src/workers/node-entry-bootstrap.ts',
  'src/workers/dev-server-child-bootstrap.ts',
  'src/workers/ts-lsp-worker-entry.ts',
] as const;

const GLUE_FILES = [
  'bin-executor.ts',
  'bounded-asset-fetch.ts',
  'child-terminal.ts',
  'dep-snapshot.ts',
  'dev-server-ipc.ts',
  'eddy-learned-pins.ts',
  'git-initial-baseline.ts',
  'install-artifact-identity.ts',
  'install-prefetch.ts',
  'install-stamp-authority.ts',
  'install-stamp.ts',
  'node-child-ipc.ts',
  'npm-shell-command.ts',
  'owner-bridge-key.ts',
  'owner-sync-runtime-handlers.ts',
  'owner-vfs-client.ts',
  'owner-vfs-durability.ts',
  'owner-vfs-ipc.ts',
  'owner-vfs-protocol.ts',
  'package-mutation-executor.ts',
  'preview-bridge-wiring.ts',
  'preview-port-wiring.ts',
  'process-exit.ts',
  'project-deps.ts',
  'project-document.ts',
  'project-seed-paths.ts',
  'pty-client.ts',
  'pty-protocol.ts',
  'reachable-cwd.ts',
  'registry-fetch.ts',
  'run-foreground-child.ts',
  'run-nested-shell-command.ts',
  'sqlite-wasm-provider.ts',
  'sync-mirror-vfs.ts',
  'vfs-commit-coordinator.ts',
  'vfs-snapshot-port.ts',
  'workspace-archive.ts',
] as const;

const WORKBENCH_FILES = [
  'errors.ts',
  'internal/browser-playground-workbench-composition.ts',
  'internal/browser-workbench-composition.ts',
  'internal/node-command.ts',
  'internal/own-property.ts',
  'internal/playground-archive.ts',
  'internal/playground-boot-config.ts',
  'internal/playground-owner-protocol.ts',
  'internal/playground-preview-registry.ts',
  'internal/playground-project-catalog.ts',
  'internal/playground-project-definition.ts',
  'internal/playground-scm.ts',
  'internal/playground-session-tool-coordinator.ts',
  'internal/playground-session-tools-transport.ts',
  'internal/playground-terminal-state.ts',
  'internal/playground-typescript.ts',
  'internal/playground-workbench.ts',
  'internal/project-package-config.ts',
  'internal/project-runtime-acquisition.ts',
  'internal/snapshot-fs.ts',
  'internal/typescript-relay-client.ts',
  'internal/vite-project-policy.ts',
  'node-project-runtime.ts',
  'open-workbench.ts',
  'owner-protocol.ts',
  'playground.ts',
  'preview-readiness.ts',
  'project-acquisition-waiters.ts',
  'project-content-transport.ts',
  'project-content.ts',
  'project-definition.ts',
  'project-documents.ts',
  'project-file-boundary.ts',
  'project-files.ts',
  'project-materialization.ts',
  'project-session.ts',
  'project-terminal-state.ts',
  'project-terminal.ts',
  'project-vfs-contract.ts',
  'project-vfs-protocol.ts',
  'public.ts',
  'service-worker-control.ts',
  'vite-project-runtime.ts',
  'workbench-browser-owner.ts',
  'workbench-owner-port.ts',
] as const;

const WORKER_FILES = [
  'dev-boot-clean.ts',
  'dev-server-boot.ts',
  'dev-server-child-bootstrap.ts',
  'dev-server-child-config.ts',
  'dev-server-controller.ts',
  'esbuild-runtime-fs.ts',
  'generated/esbuild-runtime.js',
  'kernel-worker-entry.ts',
  'node-entry-bootstrap.ts',
  'node-entry-remote-fs.ts',
  'node-entry-resolve.ts',
  'node-program-lifecycle.ts',
  'node-worker-runtime-config.ts',
  'owner-child-admission.ts',
  'owner-child-bin-executor.ts',
  'owner-child-dev-server.ts',
  'owner-child-node-executor.ts',
  'owner-git-commit-identity.ts',
  'owner-package-state.ts',
  'owner-storage.ts',
  'owner-vfs-applied-journal.ts',
  'owner-vfs-authority.ts',
  'package-acquisition-authority.ts',
  'package-install-finalizer.ts',
  'package-tree-unattested-error.ts',
  'playground-archive-integration.ts',
  'playground-project-authority.ts',
  'playground-session-tools-owner.ts',
  'port-watch.ts',
  'preview-producer-bindings.ts',
  'preview-registry.ts',
  'project-terminal-namespace.ts',
  'pty-server.ts',
  'runtime-asset-public-error.ts',
  'ts-lsp-owner-relay.ts',
  'ts-lsp-worker-entry.ts',
  'vite-cli-install-policy.ts',
  'vite-cli-prep.ts',
  'vite-esbuild-runtime.ts',
  'workbench-construction-transaction.ts',
  'workbench-owner-bootstrap.ts',
  'workbench-owner-child-vfs.ts',
  'workbench-owner-close.ts',
  'workbench-owner-controller.ts',
  'workbench-owner-storage-composition.ts',
  'workbench-owner-storage-retention.ts',
  'workbench-owner-storage.ts',
  'workbench-package-config.ts',
  'workbench-project-composition.ts',
  'workbench-project-runtime.ts',
  'workbench-project-store.ts',
  'workbench-project-vfs.ts',
  'workbench-runtime-assets.ts',
  'worker-runtime-globals.ts',
] as const;

const EXPECTED_APP_PRODUCTION_FILES = [
  'generated/install-artifact-identity.json',
  ...GLUE_FILES.map((path) => `glue/${path}`),
  ...WORKBENCH_FILES.map((path) => `workbench/${path}`),
  ...WORKER_FILES.map((path) => `workers/${path}`),
].sort();

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

function packagePathFor(appPath: string): string {
  return `src/${appPath}`;
}

const EXPECTED_PACKAGE_PRODUCTION_FILES = EXPECTED_APP_PRODUCTION_FILES.map(packagePathFor).sort();

function isProductionSource(path: string): boolean {
  return !/(?:\.(?:contract\.)?(?:fault\.)?test|\.test-fixture)\.[cm]?[jt]sx?$/u.test(path);
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
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      references.push({ importer: path, specifier: node.arguments[0].text, isStatic: false });
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

function resolvedExportEntries(): readonly string[] {
  return Object.values(readManifest().exports).map((target) => resolve(PACKAGE_ROOT, target));
}

describe('@riftydev/workbench extraction boundary', () => {
  it('pins the exact 137-file production move without test-decoupling sources', () => {
    expect(EXPECTED_APP_PRODUCTION_FILES).toHaveLength(137);
    expect(new Set(EXPECTED_APP_PRODUCTION_FILES).size).toBe(137);
    expect(new Set(EXPECTED_PACKAGE_PRODUCTION_FILES).size).toBe(137);
    expect(EXPECTED_APP_PRODUCTION_FILES.filter((path) => !isProductionSource(path))).toEqual([]);
  });

  it('resolves all seven package source exports', () => {
    const entries = resolvedExportEntries();
    const relativeEntries = entries.map((path) => relative(PACKAGE_ROOT, path));

    expect(relativeEntries).toEqual(EXPORTED_SOURCE_ENTRIES);
    expect(
      entries.filter((path) => !existsSync(path)).map((path) => relative(PACKAGE_ROOT, path)),
    ).toEqual([]);
    expect(entries.filter(isOutsidePackage)).toEqual([]);
  });

  it('has the exact package-contained production closure', () => {
    const entries = resolvedExportEntries();
    const missingEntries = entries.filter((path) => !existsSync(path));
    expect(missingEntries.map((path) => relative(PACKAGE_ROOT, path))).toEqual([]);

    const closure = sourceClosure(entries);
    const files = [...closure.files].map((path) => relative(PACKAGE_ROOT, path)).sort();
    expect(closure.escapedEdges).toEqual([]);
    expect(closure.unresolvedEdges).toEqual([]);
    expect(files).toEqual(EXPECTED_PACKAGE_PRODUCTION_FILES);
    expect(files.filter((path) => !isProductionSource(path))).toEqual([]);
  });

  it('uses only the exact external packages and no App, bundler-query, env, Solid, or Monaco imports', () => {
    const entries = resolvedExportEntries();
    const missingEntries = entries.filter((path) => !existsSync(path));
    expect(missingEntries.map((path) => relative(PACKAGE_ROOT, path))).toEqual([]);

    const closure = sourceClosure(entries);
    const references = closure.allReferences;
    const forbiddenAppImports = references
      .filter(
        ({ specifier }) =>
          specifier.includes('apps/playground') || specifier.startsWith('@riftydev/playground'),
      )
      .map(({ importer, specifier }) => `${relative(PACKAGE_ROOT, importer)} -> ${specifier}`)
      .sort();
    const queryImports = references
      .filter(({ specifier }) => specifier.includes('?'))
      .map(({ importer, specifier }) => `${relative(PACKAGE_ROOT, importer)} -> ${specifier}`)
      .sort();
    const forbiddenUiImports = references
      .filter(({ specifier }) => {
        const dependency = packageName(specifier);
        return dependency === 'solid-js' || dependency === 'monaco-editor';
      })
      .map(({ importer, specifier }) => `${relative(PACKAGE_ROOT, importer)} -> ${specifier}`)
      .sort();

    expect([...closure.externalPackages].sort()).toEqual(EXPECTED_EXTERNAL_PACKAGES);
    expect(Object.keys(readManifest().dependencies).sort()).toEqual(EXPECTED_EXTERNAL_PACKAGES);
    expect(forbiddenAppImports).toEqual([]);
    expect(queryImports).toEqual([]);
    expect(closure.importMetaEnvFiles).toEqual([]);
    expect(forbiddenUiImports).toEqual([]);
  });

  it('removes every mapped production source from apps/playground', () => {
    const remainingAppCopies = EXPECTED_APP_PRODUCTION_FILES.filter((path) =>
      existsSync(resolve(APP_SRC_ROOT, path)),
    );

    expect(remainingAppCopies).toEqual([]);
  });
});
