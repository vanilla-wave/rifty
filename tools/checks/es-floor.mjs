#!/usr/bin/env node
/** Shipped browser code: ES2022 syntax and post-floor builtin call sites (ADR-0469). */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reuse the parser already owned by the architecture gate; no second parser dependency.
const require = createRequire(import.meta.url);
const { TraceMap, originalPositionFor, sourceContentFor } = createRequire(
  require.resolve('vitest'),
)('@jridgewell/trace-mapping');
const { parse } = createRequire(
  realpathSync(new URL('../../node_modules/dependency-cruiser/package.json', import.meta.url)),
)('acorn');

export const GUARDED_BUILTINS = Object.freeze({
  'Atomics.waitAsync': 'ADR-0469: kernel capability guards and workbench support probes',
});
const STATIC_BUILTINS = new Set([
  'Array.fromAsync',
  'Object.groupBy',
  'Map.groupBy',
  'Promise.withResolvers',
  'Promise.try',
  'RegExp.escape',
  'Uint8Array.fromBase64',
  'Uint8Array.fromHex',
  'Atomics.pause',
]);
const METHODS = new Set([
  'toSorted',
  'toReversed',
  'toSpliced',
  'findLast',
  'findLastIndex',
  'isWellFormed',
  'toWellFormed',
  'transferToFixedLength',
  'union',
  'intersection',
  'difference',
  'symmetricDifference',
  'isSubsetOf',
  'isSupersetOf',
  'isDisjointFrom',
  'toBase64',
  'toHex',
  'setFromBase64',
  'setFromHex',
]);
const CONSTRUCTORS = new Set([
  'Iterator',
  'AsyncIterator',
  'DisposableStack',
  'AsyncDisposableStack',
  'Float16Array',
]);

// Ambiguous names (grow/resize/transfer/map) need an explicit intrinsic receiver.
const PROTOTYPE_BUILTINS = new Set([
  'ArrayBuffer.prototype.resize',
  'ArrayBuffer.prototype.transfer',
  'ArrayBuffer.prototype.transferToFixedLength',
  'ArrayBuffer.prototype.resizable',
  'ArrayBuffer.prototype.maxByteLength',
  'ArrayBuffer.prototype.detached',
  'SharedArrayBuffer.prototype.grow',
  'SharedArrayBuffer.prototype.growable',
  'SharedArrayBuffer.prototype.maxByteLength',
  'DataView.prototype.getFloat16',
  'DataView.prototype.setFloat16',
]);

function intrinsicName(member) {
  const name = memberName(member)?.replace(/^globalThis\./, '');
  if (
    STATIC_BUILTINS.has(name) ||
    PROTOTYPE_BUILTINS.has(name) ||
    CONSTRUCTORS.has(name?.split('.')[0])
  )
    return name;
  if (member.object?.type !== 'NewExpression') return null;
  const constructor = memberName(member.object.callee)?.replace(/^globalThis\./, '');
  const prototype = `${constructor}.prototype.${propertyName(member)}`;
  return PROTOTYPE_BUILTINS.has(prototype) ? prototype : null;
}

// Exact own-method calls in the currently shipped Monaco version; maps bind minified receivers.
const MONACO_WITH_CALLS = {
  'editor/common/core/position.js': [
    'this.with(this.lineNumber + deltaLineNumber, this.column + deltaColumn)',
  ],
  'editor/common/cursor/cursorDeleteOperations.js': ['position.with(undefined, idx + 1)'],
  'editor/contrib/inlayHints/browser/inlayHintsController.js': ['obj.item.with({ anchor })'],
  'editor/contrib/inlineCompletions/browser/model/provideInlineCompletions.js': [
    'position.with(undefined, maxColumn)',
  ],
  'editor/contrib/suggest/browser/suggestWidgetDetails.js': [
    'maxSizeTop.with(undefined, anchorBox.top + anchorBox.height - info.borderHeight - info.verticalPadding)',
    'defaultMinSize.with(Math.min(width, defaultMinSize.width))',
    'defaultMinSize.with(maxSizeBottom.width)',
  ],
  'editor/contrib/suggest/browser/suggestWidget.js': ['dim.with(undefined, minPersistedHeight)'],
};
const OWN_WITH_FIELDS = new Set(['scheme', 'authority', 'path', 'query', 'fragment', 'prerelease']);

function propertyName(node) {
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  return node.property?.type === 'Literal' && typeof node.property.value === 'string'
    ? node.property.value
    : null;
}
function memberName(node) {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type !== 'MemberExpression') return null;
  const object = memberName(node.object);
  const property = propertyName(node);
  return object && property ? `${object}.${property}` : null;
}
function walk(node, visit, parent = null, grandparent = null) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node, parent, grandparent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node, parent);
    } else if (value && typeof value === 'object') walk(value, visit, node, parent);
  }
}

export function bundleViolations(file, source, loadSourceMap = () => null) {
  let tree;
  try {
    tree = parse(source, { ecmaVersion: 2022, sourceType: 'module' });
  } catch (error) {
    return [
      `${file}:${error.loc?.line ?? 1}:${(error.loc?.column ?? 0) + 1}: ES2022 syntax: ${error.message}`,
    ];
  }
  const errors = [];
  function report(node, name) {
    const before = source.slice(0, node.start);
    const line = before.split('\n').length;
    const column = node.start - before.lastIndexOf('\n');
    errors.push(`${file}:${line}:${column}: post-ES2022 builtin ${name}`);
  }
  let sourceMap;
  function monacoOwnWith(node) {
    if (sourceMap === undefined) {
      const raw = loadSourceMap();
      sourceMap = raw ? new TraceMap(raw) : null;
    }
    if (!sourceMap) return false;
    const before = source.slice(0, node.start);
    const origin = originalPositionFor(sourceMap, {
      line: before.split('\n').length,
      column: node.start - before.lastIndexOf('\n') - 1,
    });
    const path = origin.source?.split('monaco-editor@0.52.2/node_modules/monaco-editor/esm/vs/')[1];
    const calls = MONACO_WITH_CALLS[path];
    if (!calls || origin.line === null || origin.column === null) return false;
    const line = sourceContentFor(sourceMap, origin.source)?.split('\n')[origin.line - 1];
    return calls.some((call) => line?.slice(origin.column).startsWith(call));
  }
  function inspectMethod(member, call) {
    const method = propertyName(member);
    // Monaco's bracket query returns CallbackIterable, whose own findLast predates ES2023.
    const bracketIterable =
      method === 'findLast' &&
      member.object?.type === 'CallExpression' &&
      member.object.callee.type === 'MemberExpression' &&
      propertyName(member.object.callee) === 'getBracketPairsInRange';
    if (METHODS.has(method) && !bracketIterable) report(member, method);
    if (method !== 'with') return;
    if (
      member.object?.type === 'MemberExpression' &&
      propertyName(member.object) === 'ChangeTracker'
    )
      return;
    const argument = call?.arguments[0];
    const ownChange =
      member.object?.type !== 'ArrayExpression' &&
      call?.arguments.length === 1 &&
      argument?.type === 'ObjectExpression' &&
      argument.properties.length > 0 &&
      argument.properties.every(
        (property) =>
          property.type === 'Property' &&
          !property.computed &&
          OWN_WITH_FIELDS.has(property.key.name ?? property.key.value),
      );
    if (!ownChange && !monacoOwnWith(member)) report(member, 'with');
  }
  function inspectPattern(pattern, receiver) {
    for (const property of pattern.properties) {
      if (property.type !== 'Property') continue;
      const member = {
        type: 'MemberExpression',
        object: receiver,
        property: property.key,
        computed: property.computed,
        start: property.start,
      };
      const intrinsic = intrinsicName(member);
      if (intrinsic) report(property, intrinsic);
      inspectMethod(member, null);
      if (property.value.type === 'ObjectPattern') inspectPattern(property.value, member);
    }
  }
  walk(tree, (node, parent, grandparent) => {
    if (node.type === 'MemberExpression') {
      const intrinsic = intrinsicName(node);
      if (intrinsic) report(node, intrinsic);
      // esbuild's import attributes are data; Monaco URI predicates only inspect availability.
      const fields =
        grandparent?.type === 'ObjectExpression'
          ? grandparent.properties.map((property) => property.key?.name ?? property.key?.value)
          : [];
      const withData =
        propertyName(node) === 'with' &&
        ((parent?.type === 'AssignmentExpression' && parent.left === node) ||
          (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') ||
          (parent?.type === 'Property' &&
            (parent.key.name ?? parent.key.value) === 'with' &&
            ['path', 'namespace', 'pluginData'].every((key) => fields.includes(key))));
      // Reject the reference itself, including extraction, .call/.apply and .bind.
      if (!withData)
        inspectMethod(
          node,
          parent?.type === 'CallExpression' && parent.callee === node ? parent : null,
        );
    }
    if (node.type === 'ObjectPattern') {
      const receiver =
        parent?.type === 'VariableDeclarator'
          ? parent.init
          : parent?.type === 'AssignmentExpression'
            ? parent.right
            : null;
      if (parent?.type !== 'Property') inspectPattern(node, receiver);
    }
    if (node.type !== 'CallExpression' && node.type !== 'NewExpression') return;
    const name = memberName(node.callee)?.replace(/^globalThis\./, '');
    if (name && Object.hasOwn(GUARDED_BUILTINS, name)) return;
    if (CONSTRUCTORS.has(name)) {
      report(node, name);
      return;
    }
    if (
      name === 'RegExp' &&
      node.arguments[1]?.type === 'Literal' &&
      typeof node.arguments[1].value === 'string' &&
      node.arguments[1].value.includes('v')
    )
      report(node, 'RegExp v');
  });
  return errors;
}

export function checkBundleRoots(roots) {
  const errors = [];
  let files = 0;
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:m?js|cjs)$/.test(entry.name)) {
        files++;
        errors.push(
          ...bundleViolations(relative(process.cwd(), path), readFileSync(path, 'utf8'), () =>
            existsSync(`${path}.map`) ? readFileSync(`${path}.map`, 'utf8') : null,
          ),
        );
      }
    }
  }
  for (const root of roots) {
    if (!existsSync(root)) {
      errors.push(`${root}: Missing build; run pnpm build first`);
      continue;
    }
    const before = files;
    visit(root);
    if (files === before) errors.push(`${root}: No JavaScript bundles`);
  }
  return { files, errors };
}

export function shippedBundleRoots(root = process.cwd()) {
  const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const path = join(root, 'packages', entry.name, 'package.json');
      return existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).scripts?.build;
    })
    .map((entry) => join(root, 'packages', entry.name, 'dist'));
  return [
    ...packages,
    join(root, 'tools/shadow-registry/dist'),
    join(root, 'apps/playground/dist'),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { files, errors } = checkBundleRoots(shippedBundleRoots());
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`ES2022 floor: ${files} shipped bundles checked`);
}
