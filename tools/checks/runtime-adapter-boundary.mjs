#!/usr/bin/env node
/**
 * ADR-0335 generic shadow-consumer boundary.
 *
 * These modules carry generic install/link/plan/admission/launch mechanics.
 * Consumer recognition belongs in named concrete integration-edge modules,
 * never in this list. Imports may delegate to such an edge; runtime branches
 * and literals here may not name a concrete package, recipe, or Vite entry.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const GENERIC_RUNTIME_ADAPTER_MODULES = Object.freeze([
  'packages/npm-client/src/installer.ts',
  'packages/npm-client/src/linker.ts',
  'packages/npm-client/src/internal/shadow/admission.ts',
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

export const SASS_FORBIDDEN_SURFACE = Object.freeze({
  catalogConsumers: GENERIC_RUNTIME_ADAPTER_MODULES,
  registrySourceProvenance: Object.freeze([
    'packages/npm-client/src/registry.ts',
    'packages/npm-client/src/internal/shadow/source.ts',
    'packages/npm-client/src/installer.ts',
    'packages/npm-client/src/linker.ts',
    'packages/npm-client/src/internal/shadow/planner.ts',
  ]),
  vfs: Object.freeze(['packages/vfs/src']),
  kernelRuntime: Object.freeze([
    'packages/kernel/src',
    'packages/runtime-js/src',
    'packages/runtime-wasi/src',
  ]),
  workbench: Object.freeze(['packages/workbench/src']),
  managerStoreMessagePort: Object.freeze([
    'packages/npm-client/src/internal/shadow/manager.ts',
    'packages/npm-client/src/internal/shadow/port.ts',
    'packages/workbench/src/workers/owner-shadow-assets.ts',
    'packages/workbench/src/workers/owner-storage.ts',
    'packages/workbench/src/workers/workbench-owner-storage.ts',
  ]),
  esbuildAdapter: Object.freeze([
    'packages/workbench/src/workers/workbench-runtime-adapters.ts',
    'packages/workbench/src/workers/esbuild-runtime-fs.ts',
    'packages/workbench/src/workers/vite-esbuild-runtime.ts',
  ]),
});

const CONSUMER_NAME =
  /(?:^|[^a-z])(?:esbuild|lightningcss(?:-wasm)?|napi-wasm|sass(?:-embedded)?|vite)(?:[^a-z]|$)/iu;
const CONSUMER_IDENTIFIER = /(?:esbuild|lightning_?css|napi_?wasm|sass|vite)/iu;
const SASS_NAME = /(?:^|[^a-z])sass(?:-embedded)?(?:[^a-z]|$)/iu;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/u;
const NON_PRODUCTION_SOURCE =
  /(?:^|\/)(?:__tests__|_test-fixtures|fixtures?)(?:\/|$)|(?:^|\/)[^/]+\.(?:contract\.test|fixture|spec|test)\.[cm]?[jt]sx?$/u;

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

function isImportOrTypePosition(node) {
  let current = node;
  while (current.parent !== undefined) {
    current = current.parent;
    if (
      ts.isImportDeclaration(current) ||
      ts.isImportEqualsDeclaration(current) ||
      ts.isImportTypeNode(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isTypeParameterDeclaration(current) ||
      ts.isTypeNode(current)
    ) {
      return true;
    }
    if (
      (ts.isExportDeclaration(current) && current.isTypeOnly) ||
      (ts.isExportSpecifier(current) && current.isTypeOnly)
    ) {
      return true;
    }
  }
  return false;
}

function controlFlowCondition(node) {
  return ts.isIfStatement(node) ||
    ts.isSwitchStatement(node) ||
    ts.isConditionalExpression(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isForStatement(node)
    ? node.expression
    : ts.isCaseClause(node)
      ? node.expression
      : undefined;
}

function isInsideControlFlowCondition(node) {
  let current = node;
  while (current.parent !== undefined) {
    const parent = current.parent;
    if (controlFlowCondition(parent) === current) return true;
    current = parent;
  }
  return false;
}

function constantString(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken) {
    return undefined;
  }
  const left = constantString(node.left);
  if (left === undefined) return undefined;
  const right = constantString(node.right);
  return right === undefined ? undefined : `${left}${right}`;
}

function isInsideConstantStringConcatenation(node) {
  let current = node;
  while (
    current.parent !== undefined &&
    ts.isBinaryExpression(current.parent) &&
    current.parent.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    current = current.parent;
    if (constantString(current) !== undefined) return true;
  }
  return false;
}

function isMaximalConstantStringConcatenation(node) {
  const parent = node.parent;
  return !(
    parent !== undefined &&
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    constantString(parent) !== undefined
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

function isSassIdentifier(text) {
  return /(?:^|_)sass(?:_|$)/iu.test(text) || /Sass/u.test(text) || /^sass[A-Z0-9]/u.test(text);
}

function containsSassIdentifier(node) {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (ts.isIdentifier(child) && isSassIdentifier(child.text)) {
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
 * @param {boolean} genericChecks
 * @returns {string[]}
 */
function sourceBoundaryViolations(file, source, genericChecks) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations = new Set();
  const consumerName = genericChecks ? CONSUMER_NAME : SASS_NAME;
  const report = (node, reason) => {
    violations.add(`${file}:${lineOf(sourceFile, node)}: ${reason}`);
  };
  const visit = (node) => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !isModuleSpecifier(node) &&
      !isImportOrTypePosition(node) &&
      !isInsideConstantStringConcatenation(node) &&
      consumerName.test(node.text)
    ) {
      report(node, `consumer-specific runtime literal ${JSON.stringify(node.text)}`);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      isMaximalConstantStringConcatenation(node)
    ) {
      const folded = constantString(node);
      if (folded !== undefined && consumerName.test(folded)) {
        report(node, `consumer-specific runtime literal ${JSON.stringify(folded)}`);
      }
    }
    const condition = controlFlowCondition(node);
    if (
      condition !== undefined &&
      (genericChecks ? containsConsumerIdentifier(condition) : containsSassIdentifier(condition))
    ) {
      report(condition, 'consumer-specific identifier in a generic control-flow condition');
    }
    if (
      ts.isIdentifier(node) &&
      isSassIdentifier(node.text) &&
      !isImportOrTypePosition(node) &&
      !isInsideControlFlowCondition(node)
    ) {
      report(node, `consumer-specific runtime identifier ${JSON.stringify(node.text)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...violations];
}

/**
 * @param {string} file
 * @param {string} source
 * @returns {string[]}
 */
export function runtimeAdapterBoundaryViolations(file, source) {
  return sourceBoundaryViolations(file, source, true);
}

function isProductionSource(file) {
  return SOURCE_FILE.test(file) && !NON_PRODUCTION_SOURCE.test(file);
}

function collectProductionSources(root, path, files) {
  const absolute = join(root, path);
  const metadata = statSync(absolute);
  if (metadata.isFile()) {
    if (isProductionSource(path)) files.add(path);
    return;
  }
  if (!metadata.isDirectory()) return;
  for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) collectProductionSources(root, child, files);
    else if (entry.isFile() && isProductionSource(child)) files.add(child);
  }
}

export function evaluateRuntimeAdapterBoundary(root = process.cwd()) {
  const sassFiles = new Set();
  for (const paths of Object.values(SASS_FORBIDDEN_SURFACE)) {
    for (const path of paths) collectProductionSources(root, path, sassFiles);
  }
  const sources = new Map();
  const source = (file) => {
    const existing = sources.get(file);
    if (existing !== undefined) return existing;
    const value = readFileSync(`${root}/${file}`, 'utf8');
    sources.set(file, value);
    return value;
  };
  const violations = new Set();
  for (const file of GENERIC_RUNTIME_ADAPTER_MODULES) {
    for (const violation of sourceBoundaryViolations(file, source(file), true)) {
      violations.add(violation);
    }
  }
  for (const file of [...sassFiles].sort()) {
    for (const violation of sourceBoundaryViolations(file, source(file), false)) {
      violations.add(violation);
    }
  }
  return [...violations];
}

function main() {
  const violations = evaluateRuntimeAdapterBoundary();
  if (violations.length !== 0) {
    console.error(`runtime-adapter-boundary: ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `runtime-adapter-boundary: ${GENERIC_RUNTIME_ADAPTER_MODULES.length} generic modules and ${Object.keys(SASS_FORBIDDEN_SURFACE).length} Sass-forbidden categories consumer-branch-free`,
  );
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
