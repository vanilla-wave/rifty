#!/usr/bin/env node
/**
 * ADR-0328 generic shadow-consumer boundary.
 *
 * These modules carry generic install/link/plan/admission/launch mechanics.
 * Consumer recognition belongs in named concrete integration-edge modules,
 * never in this list. Imports may delegate to such an edge; runtime branches
 * and literals here may not name a concrete package, recipe, or Vite entry.
 */
import { readFileSync } from 'node:fs';
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

const CONSUMER_NAME =
  /(?:^|[^a-z])(?:esbuild|lightningcss(?:-wasm)?|napi-wasm|sass(?:-embedded)?|vite)(?:[^a-z]|$)/iu;
const CONSUMER_IDENTIFIER = /(?:esbuild|lightning_?css|napi_?wasm|sass|vite)/iu;

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

function main() {
  const violations = evaluateRuntimeAdapterBoundary();
  if (violations.length !== 0) {
    console.error(`runtime-adapter-boundary: ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  ✗ ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `runtime-adapter-boundary: ${GENERIC_RUNTIME_ADAPTER_MODULES.length} generic modules consumer-branch-free`,
  );
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
