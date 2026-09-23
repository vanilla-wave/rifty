import { NotImplementedError } from '@riftydev/io';
import { uniqueHelperName } from './cjs-source-rewrite.ts';

/** Property-key analysis shared by the CJS and ESM Function guards. */
interface GuardNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface SymbolCallSpan {
  readonly start: number;
  readonly end: number;
}

export interface SymbolKeyScope {
  readonly bindings: ReadonlySet<string>;
  readonly symbolBindings: Map<string, SymbolCallSpan>;
}

export function assertSymbolPropertyKey(value: unknown, kind: 'cjs' | 'esm'): symbol {
  if (typeof value !== 'symbol') {
    throw new NotImplementedError(`module-loader.${kind}-global-function-assignment`);
  }
  return value;
}

export function allocateSymbolKeyHelperNames(
  source: string,
  reserved: ReadonlySet<string> = new Set(),
): { readonly helperName: string; readonly argumentName: string } {
  const helperName = uniqueHelperName(source, '__riftySymbolKey', reserved);
  const argumentName = uniqueHelperName(
    source,
    '__riftySymbolKeyArgument',
    new Set([...reserved, helperName]),
  );
  return { helperName, argumentName };
}

export function unwrapChain(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as GuardNode;
  if (n.type === 'ChainExpression') return unwrapChain(n.expression);
  if (n.type === 'SequenceExpression') {
    const expressions = (n as { expressions?: unknown[] }).expressions ?? [];
    return unwrapChain(expressions[expressions.length - 1]);
  }
  return node;
}

export function literalString(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = unwrapChain(node) as GuardNode;
  if (n.type === 'Literal') return typeof n.value === 'string' ? n.value : undefined;
  if (n.type === 'BinaryExpression' && n.operator === '+') {
    const left = literalString(n.left);
    const right = literalString(n.right);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  if (n.type === 'TemplateLiteral') {
    const expressions = (n as { expressions?: unknown[] }).expressions ?? [];
    if (expressions.length > 0) return undefined;
    const quasis = (n as { quasis?: GuardNode[] }).quasis ?? [];
    return quasis
      .map((quasi) => {
        const value = quasi.value as { cooked?: unknown } | undefined;
        return typeof value?.cooked === 'string' ? value.cooked : '';
      })
      .join('');
  }
  return undefined;
}

export function staticPropertyName(node: GuardNode): string | undefined {
  const n = unwrapChain(node) as GuardNode;
  const property = n.property as GuardNode | undefined;
  if (!property) return undefined;
  if (!n.computed && property.type === 'Identifier') {
    return typeof property.name === 'string' ? property.name : undefined;
  }
  return n.computed ? literalString(property) : undefined;
}

export function isComputedMember(node: GuardNode): boolean {
  return Boolean((unwrapChain(node) as GuardNode).computed);
}

export function staticPropertyKeyName(node: GuardNode): string | undefined {
  const key = node.key as GuardNode | undefined;
  if (!key) return undefined;
  if (!node.computed && key.type === 'Identifier') {
    return typeof key.name === 'string' ? key.name : undefined;
  }
  return literalString(key);
}

function symbolCall(node: unknown, symbolShadowed: boolean): SymbolCallSpan | undefined {
  if (symbolShadowed || !node || typeof node !== 'object') return undefined;
  const call = unwrapChain(node) as GuardNode;
  if (call.type !== 'CallExpression' || call.optional) return undefined;
  const callee = unwrapChain(call.callee) as GuardNode | undefined;
  if (!callee) return undefined;
  if (callee.type === 'Identifier')
    return callee.name === 'Symbol' ? (call as GuardNode & SymbolCallSpan) : undefined;
  if (callee.type !== 'MemberExpression' || callee.optional) return undefined;
  const object = unwrapChain(callee.object) as GuardNode | undefined;
  return object?.type === 'Identifier' &&
    object.name === 'Symbol' &&
    staticPropertyName(callee) === 'for'
    ? (call as GuardNode & SymbolCallSpan)
    : undefined;
}

export function markSymbolConstBinding(
  id: unknown,
  init: unknown,
  scopes: readonly SymbolKeyScope[],
  symbolShadowed: boolean,
): void {
  if (!id || typeof id !== 'object') return;
  const call = symbolCall(init, symbolShadowed);
  if (!call) return;
  const binding = id as GuardNode;
  if (binding.type !== 'Identifier' || typeof binding.name !== 'string') return;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!scope?.bindings.has(binding.name)) continue;
    scope.symbolBindings.set(binding.name, call);
    return;
  }
}

function symbolCallForKey(
  node: unknown,
  scopes: readonly SymbolKeyScope[],
  symbolShadowed: boolean,
): SymbolCallSpan | undefined {
  const call = symbolCall(node, symbolShadowed);
  if (call) return call;
  if (!node || typeof node !== 'object') return undefined;
  const binding = unwrapChain(node) as GuardNode;
  if (binding.type !== 'Identifier' || typeof binding.name !== 'string') return undefined;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (scope?.bindings.has(binding.name)) return scope.symbolBindings.get(binding.name);
  }
  return undefined;
}

export function planRuntimeCheckedSymbolKey(
  node: unknown,
  scopes: readonly SymbolKeyScope[],
  symbolShadowed: boolean,
  helperName: string,
  guardedCalls: Set<number>,
  edits: Array<{ readonly start: number; readonly end: number; readonly text: string }>,
): boolean {
  const call = symbolCallForKey(node, scopes, symbolShadowed);
  if (!call) return false;
  if (!guardedCalls.has(call.start)) {
    guardedCalls.add(call.start);
    edits.push({ start: call.start, end: call.start, text: `${helperName}(` });
    edits.push({ start: call.end, end: call.end, text: ')' });
  }
  return true;
}
