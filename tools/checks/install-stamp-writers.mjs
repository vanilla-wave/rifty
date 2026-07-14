#!/usr/bin/env node
/** One-writer gate for the install-stamp claim (ADR-0261). */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const CLAIM_FILE = '.rifty-install-stamp.json';
const AUTHORITY = 'apps/playground/src/glue/install-stamp-authority.ts';
const OWNER_AUTHORITY = 'apps/playground/src/workers/owner-vfs-authority.ts';
const OWNER_CLAIM_FLOW_CONTEXTS = new Set([
  '#readInstallStampClaim',
  '#writeInstallStampClaim',
  '#removeInstallStampClaim',
]);
const OWNER_CLAIM_MUTATION_CONTEXTS = new Set([
  '#writeInstallStampClaim',
  '#removeInstallStampClaim',
]);
const SOURCE_ROOT = 'apps/playground/src';
const NO_NAMES = new Set();
const PACKAGE_TREE_HELPERS = new Set([
  'clearProjectTree',
  'finalizePackageInstallFiles',
  'prepareProjectInstallTree',
  'restoreDepSnapshot',
  'seedTemplateNodeModulesFiles',
]);
const PACKAGE_TREE_CONTEXTS = new Map([
  [
    'apps/playground/src/glue/project-deps.ts',
    new Set(['clearProjectTree', 'prepareProjectInstallTree', 'prepareEnsure', 'restoreSnapshot']),
  ],
  ['apps/playground/src/glue/workspace-archive.ts', new Set(['applyWorkspaceArchive'])],
  [
    'apps/playground/src/workers/real-vite-bootstrap.ts',
    new Set([
      'prepareNpmInstallFor',
      'prepareEnsure',
      'planSnapshotRestore',
      'install',
      'reset',
      'switchProject',
    ]),
  ],
]);

/** Path operands for filesystem mutations. Both operands of move/copy count:
 * moving away revokes a claim; moving/copying to the path forges one. */
const MUTATOR_PATH_ARGS = new Map([
  ['writeFile', [0]],
  ['writeFileSync', [0]],
  ['appendFile', [0]],
  ['appendFileSync', [0]],
  ['rm', [0]],
  ['rmSync', [0]],
  ['unlink', [0]],
  ['unlinkSync', [0]],
  ['rename', [0, 1]],
  ['renameSync', [0, 1]],
  ['copyFile', [0, 1]],
  ['copyFileSync', [0, 1]],
  ['cp', [0, 1]],
  ['cpSync', [0, 1]],
]);

function normalized(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function callName(call) {
  const expression = call.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function visit(node, callback) {
  callback(node);
  node.forEachChild((child) => visit(child, callback));
}

function containsIdentifier(node, names) {
  let found = false;
  visit(node, (child) => {
    if (ts.isIdentifier(child) && names.has(child.text)) found = true;
  });
  return found;
}

function referencesClaimPath(node, tainted, producers) {
  let found = false;
  visit(node, (child) => {
    if (found) return;
    const claimText =
      ts.isStringLiteral(child) ||
      ts.isNoSubstitutionTemplateLiteral(child) ||
      child.kind === ts.SyntaxKind.TemplateHead ||
      child.kind === ts.SyntaxKind.TemplateMiddle ||
      child.kind === ts.SyntaxKind.TemplateTail
        ? child.text
        : null;
    if (claimText?.includes(CLAIM_FILE)) {
      found = true;
      return;
    }
    if (ts.isIdentifier(child) && tainted.has(child.text)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(child)) {
      const name = callName(child);
      if (name === 'installStampPath' || (name !== null && producers.has(name))) found = true;
    }
  });
  return found;
}

function isInstallTreeText(text) {
  return /(?:^|[\\/])node_modules(?:$|[\\/])/.test(text);
}

function referencesInstallTreePath(node, tainted, producers) {
  let found = false;
  visit(node, (child) => {
    if (found) return;
    const pathText =
      ts.isStringLiteral(child) ||
      ts.isNoSubstitutionTemplateLiteral(child) ||
      child.kind === ts.SyntaxKind.TemplateHead ||
      child.kind === ts.SyntaxKind.TemplateMiddle ||
      child.kind === ts.SyntaxKind.TemplateTail
        ? child.text
        : null;
    if (pathText !== null && isInstallTreeText(pathText)) {
      found = true;
      return;
    }
    if (ts.isIdentifier(child) && tainted.has(child.text)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(child)) {
      const name = callName(child);
      if (name === 'installTreeDir' || (name !== null && producers.has(name))) found = true;
    }
  });
  return found;
}

function collectLocalFunctions(sourceFile) {
  const functions = new Map();
  visit(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      functions.set(node.name.text, node);
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      functions.set(node.name.text, node.initializer);
    }
  });
  return functions;
}

function returnExpressions(fn) {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body];
  const expressions = [];
  visit(fn.body, (node) => {
    if (ts.isReturnStatement(node) && node.expression) expressions.push(node.expression);
  });
  return expressions;
}

function buildClaimFlow(sourceFile, functions, file) {
  const tainted = new Set();
  const producers = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    visit(sourceFile, (node) => {
      if (ownerClaimFlowAllowed(file, node)) return;
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        !tainted.has(node.name.text) &&
        referencesClaimPath(node.initializer, tainted, producers)
      ) {
        tainted.add(node.name.text);
        changed = true;
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        !tainted.has(node.left.text) &&
        referencesClaimPath(node.right, tainted, producers)
      ) {
        tainted.add(node.left.text);
        changed = true;
      }
    });
    for (const [name, fn] of functions) {
      if (
        !producers.has(name) &&
        returnExpressions(fn).some((expression) =>
          referencesClaimPath(expression, tainted, producers),
        )
      ) {
        producers.add(name);
        changed = true;
      }
    }
  }
  return { tainted, producers };
}

function mutationIndexes(expression, sinks) {
  if (ts.isIdentifier(expression)) return sinks.get(expression.text);
  if (ts.isPropertyAccessExpression(expression)) {
    return MUTATOR_PATH_ARGS.get(expression.name.text);
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteral(expression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
  ) {
    return MUTATOR_PATH_ARGS.get(expression.argumentExpression.text);
  }
  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === 'bind'
  ) {
    return mutationIndexes(expression.expression.expression, sinks);
  }
  return undefined;
}

function addSink(sinks, name, indexes) {
  const current = sinks.get(name);
  if (current) {
    let covered = true;
    for (const index of indexes) {
      if (!current.has(index)) covered = false;
    }
    if (covered) return false;
  }
  const next = current ?? new Set();
  for (const index of indexes) next.add(index);
  sinks.set(name, next);
  return true;
}

function buildAliasedMutationSinks(sourceFile, seed) {
  const sinks = new Map([...seed].map(([name, indexes]) => [name, new Set(indexes)]));
  let changed = true;
  while (changed) {
    changed = false;
    visit(sourceFile, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const property = element.propertyName ?? element.name;
          const propertyName =
            ts.isIdentifier(property) || ts.isStringLiteral(property) ? property.text : null;
          const indexes = propertyName === null ? undefined : MUTATOR_PATH_ARGS.get(propertyName);
          if (indexes && addSink(sinks, element.name.text, indexes)) changed = true;
        }
        return;
      }
      let target = null;
      let source = null;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        target = node.name.text;
        source = node.initializer;
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        target = node.left.text;
        source = node.right;
      }
      if (target === null || source === null) return;
      const indexes = mutationIndexes(source, sinks);
      if (indexes && addSink(sinks, target, indexes)) changed = true;
    });
  }
  return sinks;
}

function buildLocalSinkParameters(functions, mutationSinks) {
  const sinks = new Map([...functions].map(([name]) => [name, new Set()]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, fn] of functions) {
      const current = sinks.get(name);
      const parameters = fn.parameters.map((parameter) =>
        ts.isIdentifier(parameter.name) ? parameter.name.text : null,
      );
      visit(fn.body, (node) => {
        if (!ts.isCallExpression(node)) return;
        const target = callName(node);
        const pathArgs = target === null ? undefined : mutationSinks.get(target);
        const localArgs = target === null ? undefined : sinks.get(target);
        const indexes = pathArgs ?? (localArgs ? [...localArgs] : []);
        for (const argumentIndex of indexes) {
          const argument = node.arguments[argumentIndex];
          if (!argument) continue;
          parameters.forEach((parameter, parameterIndex) => {
            if (
              parameter !== null &&
              !current.has(parameterIndex) &&
              containsIdentifier(argument, new Set([parameter]))
            ) {
              current.add(parameterIndex);
              changed = true;
            }
          });
        }
      });
    }
  }
  return sinks;
}

function buildMutationSinks(sourceFile, functions) {
  const sinks = new Map([...MUTATOR_PATH_ARGS].map(([name, indexes]) => [name, new Set(indexes)]));
  let changed = true;
  while (changed) {
    changed = false;
    const aliased = buildAliasedMutationSinks(sourceFile, sinks);
    const local = buildLocalSinkParameters(functions, aliased);
    for (const [name, indexes] of [...aliased, ...local]) {
      if (addSink(sinks, name, indexes)) changed = true;
    }
  }
  return sinks;
}

function lineAndColumn(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: position.line + 1, column: position.character + 1 };
}

function declaredName(node) {
  const name = node.name;
  if (name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name))) {
    return name.text;
  }
  return null;
}

function enclosingContexts(node) {
  const contexts = new Set();
  let current = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isPropertyAssignment(current) ||
      ts.isVariableDeclaration(current)
    ) {
      const name = declaredName(current);
      if (name !== null) contexts.add(name);
    }
    current = current.parent;
  }
  return contexts;
}

function packageTreeMutationAllowed(file, node) {
  for (const [allowedFile, contexts] of PACKAGE_TREE_CONTEXTS) {
    if (!file.endsWith(allowedFile)) continue;
    const enclosing = enclosingContexts(node);
    for (const context of enclosing) {
      if (contexts.has(context)) return true;
    }
  }
  return false;
}

function ownerContextAllowed(file, node, contexts) {
  if (!file.endsWith(OWNER_AUTHORITY)) return false;
  const enclosing = enclosingContexts(node);
  for (const context of enclosing) {
    if (contexts.has(context)) return true;
  }
  return false;
}

function ownerClaimFlowAllowed(file, node) {
  return ownerContextAllowed(file, node, OWNER_CLAIM_FLOW_CONTEXTS);
}

function ownerClaimMutationAllowed(file, node) {
  return ownerContextAllowed(file, node, OWNER_CLAIM_MUTATION_CONTEXTS);
}

/**
 * Returns claim-file writes plus package-tree mutations that bypass the
 * acquisition adapter. Read calls, comparisons, comments, and payload strings
 * are ignored.
 */
export function findInstallStampWriterViolations(source, filePath) {
  const file = normalized(filePath);
  if (file.endsWith(AUTHORITY)) return [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const functions = collectLocalFunctions(sourceFile);
  const { tainted, producers } = buildClaimFlow(sourceFile, functions, file);
  const mutationSinks = buildMutationSinks(sourceFile, functions);
  const violations = [];
  const seen = new Set();
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = callName(node);
    if (name === null) return;
    const indexes = [...(mutationSinks.get(name) ?? [])];
    for (const index of indexes) {
      const argument = node.arguments[index];
      if (!argument) continue;
      const claimMutation = referencesClaimPath(argument, tainted, producers);
      const treeMutation = referencesInstallTreePath(argument, NO_NAMES, NO_NAMES);
      const ownerClaimMutation = ownerClaimMutationAllowed(file, node);
      const claimAllowed = !claimMutation || ownerClaimMutation;
      const treeAllowed =
        !treeMutation || packageTreeMutationAllowed(file, node) || ownerClaimMutation;
      if (claimAllowed && treeAllowed) continue;
      const position = lineAndColumn(sourceFile, argument);
      const key = `${position.line}:${position.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({
        file,
        ...position,
        operation: name,
        message: claimMutation
          ? `${name} mutates the install-stamp claim outside ${AUTHORITY}`
          : `${name} mutates node_modules outside a package-acquisition adapter`,
      });
    }
    if (!PACKAGE_TREE_HELPERS.has(name) || packageTreeMutationAllowed(file, node)) return;
    const position = lineAndColumn(sourceFile, node);
    const key = `${position.line}:${position.column}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({
      file,
      ...position,
      operation: name,
      message: `${name} mutates node_modules outside a package-acquisition adapter`,
    });
  });
  return violations;
}

export function isProductionTypeScript(filePath) {
  const file = normalized(filePath);
  return (
    /\.[cm]?[jt]sx?$/.test(file) &&
    !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) &&
    !file.endsWith(AUTHORITY)
  );
}

function sourceFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (isProductionTypeScript(relative(root, path))) files.push(path);
    }
  };
  walk(resolve(root, SOURCE_ROOT));
  return files;
}

export function scanInstallStampWriters(root = process.cwd()) {
  return sourceFiles(root).flatMap((path) =>
    findInstallStampWriterViolations(readFileSync(path, 'utf8'), relative(root, path)),
  );
}

function main() {
  const violations = scanInstallStampWriters();
  if (violations.length === 0) {
    console.log('install-stamp-writers: OK (claim/tree mutations confined to authorities)');
    return;
  }
  console.error(`install-stamp-writers: ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}:${violation.column} ${violation.message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
