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
  'Atomics.waitAsync': 'ADR-0469: verified local typeof guards only',
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
  const parents = new WeakMap();
  const bindings = new WeakMap();
  const assignments = new WeakMap();
  const immutableBindings = new WeakSet();
  const isFunction = (node) =>
    ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node?.type);
  function scopeAt(node, functionScope = false) {
    for (let current = node; current; current = parents.get(current)) {
      if (
        current.type === 'Program' ||
        (!functionScope && current.type === 'BlockStatement') ||
        isFunction(current)
      )
        return current;
    }
    return tree;
  }
  function declare(name, value, node) {
    const scope = scopeAt(node, node?.type === 'VariableDeclaration' && node.kind === 'var');
    if (!bindings.has(scope)) bindings.set(scope, new Map());
    const previous = bindings.get(scope).get(name);
    if (previous) {
      if (!assignments.has(previous)) assignments.set(previous, []);
      assignments.get(previous).push(value.init);
      immutableBindings.delete(previous);
      return;
    }
    bindings.get(scope).set(name, value);
    if (node?.type === 'VariableDeclaration' && node.kind === 'const') immutableBindings.add(value);
  }
  function declarePattern(pattern, receiver, owner) {
    for (const property of pattern.properties) {
      if (property.type !== 'Property') {
        declareUnknown(property.argument, owner);
        continue;
      }
      const member = {
        type: 'MemberExpression',
        object: receiver,
        property: property.key,
        computed: property.computed,
      };
      parents.set(member, owner);
      if (property.value.type === 'Identifier')
        declare(property.value.name, { init: member }, owner);
      else if (property.value.type === 'ObjectPattern')
        declarePattern(property.value, member, owner);
      else declareUnknown(property.value, owner);
    }
  }
  function declareUnknown(pattern, owner) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') declare(pattern.name, { init: null }, owner);
    else if (pattern.type === 'ObjectPattern') {
      for (const property of pattern.properties)
        declareUnknown(property.value ?? property.argument, owner);
    } else if (pattern.type === 'ArrayPattern') {
      for (const element of pattern.elements) declareUnknown(element, owner);
    } else declareUnknown(pattern.left ?? pattern.argument, owner);
  }
  walk(tree, (node, parent) => {
    parents.set(node, parent);
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier')
      declare(node.id.name, node, parent);
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern')
      declarePattern(node.id, node.init, parent);
    if (node.type === 'VariableDeclarator' && node.id.type === 'ArrayPattern')
      declareUnknown(node.id, parent);
    if (node.type === 'FunctionDeclaration' && node.id) declare(node.id.name, node, parent);
    if (isFunction(node)) for (const param of node.params) declareUnknown(param, node);
    if (node.type === 'CatchClause') declareUnknown(node.param, node.body);
  });
  function binding(identifier) {
    for (let current = identifier; current; current = parents.get(current)) {
      const found = bindings.get(current)?.get(identifier.name);
      if (found) return found;
    }
    return null;
  }
  walk(tree, (node) => {
    if (node.type !== 'AssignmentExpression' || node.left.type !== 'Identifier') return;
    const declaration = binding(node.left);
    if (!declaration) return;
    if (!assignments.has(declaration)) assignments.set(declaration, []);
    assignments.get(declaration).push(node.right);
  });
  function nativeName(node, seen = new Set(), requireImmutable = false) {
    if (!node) return null;
    if (node.type === 'Identifier') {
      const declaration = binding(node);
      if (!declaration) return node.name;
      if (seen.has(declaration)) return null;
      if (requireImmutable && (!immutableBindings.has(declaration) || assignments.has(declaration)))
        return null;
      seen.add(declaration);
      const names = [declaration.init, ...(assignments.get(declaration) ?? [])]
        .map((value) => nativeName(value, new Set(seen), requireImmutable))
        .filter(Boolean);
      return (
        names.find((name) => name === 'Atomics' || name === 'Atomics.waitAsync') ?? names[0] ?? null
      );
    }
    if (node.type !== 'MemberExpression') return null;
    const object = nativeName(node.object, seen, requireImmutable);
    return object ? `${object}.${propertyName(node)}`.replace(/^globalThis\./, '') : null;
  }
  function guarantees(test, truth) {
    if (test.type === 'UnaryExpression' && test.operator === '!')
      return guarantees(test.argument, !truth);
    if (test.type === 'LogicalExpression') {
      if ((test.operator === '&&' && truth) || (test.operator === '||' && !truth)) {
        return guarantees(test.left, truth) || guarantees(test.right, truth);
      }
      return false;
    }
    if (test.type !== 'BinaryExpression') return false;
    const [probe, expected] =
      test.left.type === 'UnaryExpression' ? [test.left, test.right] : [test.right, test.left];
    return (
      probe.type === 'UnaryExpression' &&
      probe.operator === 'typeof' &&
      nativeName(probe.argument, new Set(), true) === 'Atomics.waitAsync' &&
      expected.type === 'Literal' &&
      expected.value === 'function' &&
      ((truth && ['===', '=='].includes(test.operator)) ||
        (!truth && ['!==', '!='].includes(test.operator)))
    );
  }
  function terminates(statement) {
    if (statement?.type === 'BlockStatement') return terminates(statement.body.at(-1));
    return statement?.type === 'ThrowStatement' || statement?.type === 'ReturnStatement';
  }
  function locallyGuarded(node) {
    for (
      let child = node, parent = parents.get(child);
      parent;
      child = parent, parent = parents.get(parent)
    ) {
      if (isFunction(parent)) return false;
      if (
        parent.type === 'UnaryExpression' &&
        parent.operator === 'typeof' &&
        parent.argument === node
      )
        return true;
      if (['IfStatement', 'ConditionalExpression'].includes(parent.type)) {
        if (child === parent.consequent && guarantees(parent.test, true)) return true;
        if (child === parent.alternate && guarantees(parent.test, false)) return true;
      }
      if (parent.type === 'LogicalExpression' && child === parent.right) {
        if (parent.operator === '&&' && guarantees(parent.left, true)) return true;
        if (parent.operator === '||' && guarantees(parent.left, false)) return true;
      }
      if (parent.type === 'BlockStatement') {
        const preceding = parent.body.slice(0, parent.body.indexOf(child));
        if (
          preceding.some(
            (statement) =>
              statement.type === 'IfStatement' &&
              guarantees(statement.test, false) &&
              terminates(statement.consequent),
          )
        )
          return true;
      }
    }
    return false;
  }
  function guardedExtraction(node) {
    const declaration = parents.get(node);
    if (
      declaration?.type !== 'VariableDeclarator' ||
      declaration.init !== node ||
      declaration.id.type !== 'Identifier' ||
      parents.get(declaration)?.kind !== 'const'
    )
      return false;
    let valid = true;
    walk(scopeAt(declaration), (reference, parent) => {
      if (
        reference.type !== 'Identifier' ||
        reference === declaration.id ||
        binding(reference) !== declaration
      )
        return;
      if (parent?.type === 'MemberExpression' && parent.property === reference && !parent.computed)
        return;
      if (
        parent?.type === 'Property' &&
        parent.key === reference &&
        !parent.computed &&
        !parent.shorthand
      )
        return;
      if (!locallyGuarded(reference)) valid = false;
    });
    return valid;
  }
  function waitAsyncAllowed(node) {
    return locallyGuarded(node) || guardedExtraction(node);
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
      parents.set(member, pattern);
      if (nativeName(member) === 'Atomics.waitAsync' && !waitAsyncAllowed(member))
        report(property, 'Atomics.waitAsync');
      const intrinsic = intrinsicName(member);
      if (intrinsic) report(property, intrinsic);
      inspectMethod(member, null);
      if (property.value.type === 'ObjectPattern') inspectPattern(property.value, member);
    }
  }
  walk(tree, (node, parent, grandparent) => {
    if (node.type === 'MemberExpression') {
      if (nativeName(node) === 'Atomics.waitAsync' && !waitAsyncAllowed(node))
        report(node, 'Atomics.waitAsync');
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
