#!/usr/bin/env node
/**
 * ADR-0323 shadow-policy and executable-adapter boundary.
 *
 * These modules carry generic plan/admission/launch mechanics. Consumer
 * recognition belongs in named concrete integration-edge modules, never in
 * this list. Imports may delegate to such an edge; runtime branches and
 * literals here may not name a concrete shadow consumer.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const GENERIC_RUNTIME_ADAPTER_MODULES = Object.freeze([
  'packages/npm-client/src/installer.ts',
  'packages/npm-client/src/linker.ts',
  'packages/npm-client/src/package-bin.ts',
  'packages/npm-client/src/internal/shadow/planner.ts',
  'packages/npm-client/src/internal/shadow/manager.ts',
  'packages/npm-client/src/internal/shadow/port.ts',
  'packages/workbench/src/workers/package-acquisition-authority.ts',
  'packages/workbench/src/workers/owner-package-state.ts',
  'packages/workbench/src/workers/owner-child-admission.ts',
  'packages/workbench/src/workers/owner-shadow-assets.ts',
  'packages/workbench/src/workers/workbench-project-runtime.ts',
  'packages/workbench/src/workers/workbench-owner-controller.ts',
  'packages/workbench/src/workers/owner-child-node-executor.ts',
  'packages/workbench/src/workers/owner-child-bin-executor.ts',
  'packages/workbench/src/workers/owner-child-dev-server.ts',
  'packages/workbench/src/workers/node-entry-bootstrap.ts',
  'packages/workbench/src/workers/node-entry-runtime-preparation.ts',
]);

export const PACKAGE_BIN_AUTHORITY_MODULE = 'packages/npm-client/src/package-bin.ts';
export const PACKAGE_BIN_CONSUMER_MODULES = Object.freeze([
  'packages/npm-client/src/linker.ts',
  'packages/npm-client/src/internal/shadow/planner.ts',
]);
const NPM_CLIENT_SOURCE_ROOT = 'packages/npm-client/src';
const TYPESCRIPT_SOURCE = /\.(?:[cm]?ts|tsx)$/u;
const NON_PRODUCTION_SOURCE =
  /\.(?:test|spec|fixture|fixtures|contract-fixtures|generated)\.(?:[cm]?ts|tsx)$/u;
const NON_PRODUCTION_DIRECTORIES = new Set([
  '__tests__',
  '_test-fixtures',
  'generated',
  'test',
  'tests',
]);

const CONSUMER_NAME = /(?:^|[^a-z])(?:esbuild|vite|sass(?:-embedded)?|lightningcss)(?:[^a-z]|$)/iu;
const CONSUMER_IDENTIFIER = /(?:esbuild|vite|sass|lightningcss)/iu;

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isModuleSpecifier(node) {
  const parent = node.parent;
  return (
    (ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) ||
    (ts.isExportDeclaration(parent) && parent.moduleSpecifier === node) ||
    (ts.isImportTypeNode(parent) && parent.argument === node)
  );
}

function containsConsumerIdentifier(node) {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (ts.isIdentifier(child) && CONSUMER_IDENTIFIER.test(child.text)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/**
 * @param {string} file
 * @param {string} source
 * @returns {string[]}
 */
export function runtimeAdapterBoundaryViolations(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations = [];
  const report = (node, reason) => {
    violations.push(`${file}:${lineOf(sourceFile, node)}: ${reason}`);
  };
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !isModuleSpecifier(node) &&
      CONSUMER_NAME.test(node.text)
    ) {
      report(node, `consumer-specific runtime literal ${JSON.stringify(node.text)}`);
    }
    const condition =
      ts.isIfStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isForStatement(node)
        ? node.expression
        : ts.isCaseClause(node)
          ? node.expression
          : undefined;
    if (condition !== undefined && containsConsumerIdentifier(condition)) {
      report(condition, 'consumer-specific identifier in a generic control-flow condition');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

export function evaluateRuntimeAdapterBoundary(root = process.cwd()) {
  return GENERIC_RUNTIME_ADAPTER_MODULES.flatMap((file) =>
    runtimeAdapterBoundaryViolations(file, readFileSync(`${root}/${file}`, 'utf8')),
  );
}

function packageBinFacts(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let declarations = 0;
  let imports = 0;
  let calls = 0;
  let launchers = 0;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'linkPackageBins') {
      declarations += 1;
    }
    if (
      ts.isImportSpecifier(node) &&
      (node.propertyName?.text ?? node.name.text) === 'linkPackageBins'
    ) {
      imports += 1;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'linkPackageBins'
    ) {
      calls += 1;
    }
    const launcherHead = ts.isTemplateExpression(node)
      ? node.head.text
      : ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? node.text
        : undefined;
    if (launcherHead?.startsWith("#!/usr/bin/env node\nimport('../")) {
      launchers += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { declarations, imports, calls, launchers };
}

function normalizedRepositoryPath(file) {
  return sep === '/' ? file : file.split(sep).join('/');
}

function isNpmClientProductionTypeScriptSource(file) {
  const normalized = normalizedRepositoryPath(file);
  if (!normalized.startsWith(`${NPM_CLIENT_SOURCE_ROOT}/`)) return false;
  if (!TYPESCRIPT_SOURCE.test(normalized) || /\.d\.[cm]?ts$/u.test(normalized)) return false;
  if (NON_PRODUCTION_SOURCE.test(normalized)) return false;
  const segments = normalized.split('/');
  return !segments.some((segment) => NON_PRODUCTION_DIRECTORIES.has(segment));
}

export function listNpmClientProductionTypeScriptSources(root = process.cwd()) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const file = normalizedRepositoryPath(relative(root, absolute));
      if (entry.isDirectory()) {
        if (!NON_PRODUCTION_DIRECTORIES.has(entry.name)) visit(absolute);
      } else if (entry.isFile() && isNpmClientProductionTypeScriptSource(file)) {
        files.push(file);
      }
    }
  };
  visit(join(root, NPM_CLIENT_SOURCE_ROOT));
  return files.sort();
}

export function packageBinAuthorityViolations(sources) {
  const violations = [];
  const facts = new Map();
  for (const [rawFile, source] of sources) {
    const file = normalizedRepositoryPath(rawFile);
    if (isNpmClientProductionTypeScriptSource(file)) {
      facts.set(file, packageBinFacts(file, source));
    }
  }
  for (const file of [PACKAGE_BIN_AUTHORITY_MODULE, ...PACKAGE_BIN_CONSUMER_MODULES]) {
    if (!facts.has(file)) {
      violations.push(`${file}: missing package-bin authority surface`);
    }
  }
  const owner = facts.get(PACKAGE_BIN_AUTHORITY_MODULE);
  if (owner && (owner.declarations !== 1 || owner.launchers !== 1)) {
    violations.push(
      `${PACKAGE_BIN_AUTHORITY_MODULE}: want one linkPackageBins owner and one launcher template`,
    );
  }
  for (const file of PACKAGE_BIN_CONSUMER_MODULES) {
    const consumer = facts.get(file);
    if (consumer && (consumer.imports !== 1 || consumer.calls !== 1)) {
      violations.push(`${file}: must import and call the one package-bin owner exactly once`);
    }
  }
  for (const [file, value] of facts) {
    if (
      file !== PACKAGE_BIN_AUTHORITY_MODULE &&
      (value.declarations !== 0 || value.launchers !== 0)
    ) {
      violations.push(`${file}: duplicates package-bin implementation`);
    }
    if (
      file !== PACKAGE_BIN_AUTHORITY_MODULE &&
      !PACKAGE_BIN_CONSUMER_MODULES.includes(file) &&
      (value.imports !== 0 || value.calls !== 0)
    ) {
      violations.push(`${file}: unexpected package-bin owner caller`);
    }
  }
  return violations;
}

export function evaluatePackageBinAuthority(root = process.cwd()) {
  const sources = new Map(
    listNpmClientProductionTypeScriptSources(root).map((file) => [
      file,
      readFileSync(join(root, file), 'utf8'),
    ]),
  );
  return packageBinAuthorityViolations(sources);
}

function main() {
  const violations = [...evaluateRuntimeAdapterBoundary(), ...evaluatePackageBinAuthority()];
  if (violations.length !== 0) {
    console.error(`runtime-adapter-boundary: ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `runtime-adapter-boundary: ${GENERIC_RUNTIME_ADAPTER_MODULES.length} generic modules consumer-branch-free; one package-bin owner`,
  );
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
