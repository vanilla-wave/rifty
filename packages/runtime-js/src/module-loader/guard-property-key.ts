/** Property-key analysis shared by the CJS and ESM Function guards. */
interface GuardNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface SymbolKeyScope {
  readonly bindings: ReadonlySet<string>;
  readonly symbolBindings: Set<string>;
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

function isSymbolCall(node: unknown, symbolShadowed: boolean): boolean {
  if (symbolShadowed || !node || typeof node !== 'object') return false;
  const call = unwrapChain(node) as GuardNode;
  if (call.type !== 'CallExpression' || call.optional) return false;
  const callee = unwrapChain(call.callee) as GuardNode | undefined;
  if (!callee) return false;
  if (callee.type === 'Identifier') return callee.name === 'Symbol';
  if (callee.type !== 'MemberExpression' || callee.optional) return false;
  const object = unwrapChain(callee.object) as GuardNode | undefined;
  return (
    object?.type === 'Identifier' &&
    object.name === 'Symbol' &&
    staticPropertyName(callee) === 'for'
  );
}

export function markSymbolConstBinding(
  id: unknown,
  init: unknown,
  scopes: readonly SymbolKeyScope[],
  symbolShadowed: boolean,
): void {
  if (!id || typeof id !== 'object' || !isSymbolCall(init, symbolShadowed)) return;
  const binding = id as GuardNode;
  if (binding.type !== 'Identifier' || typeof binding.name !== 'string') return;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!scope?.bindings.has(binding.name)) continue;
    scope.symbolBindings.add(binding.name);
    return;
  }
}

export function isSymbolOnlyKey(
  node: unknown,
  scopes: readonly SymbolKeyScope[],
  symbolShadowed: boolean,
): boolean {
  if (isSymbolCall(node, symbolShadowed)) return true;
  if (!node || typeof node !== 'object') return false;
  const binding = unwrapChain(node) as GuardNode;
  if (binding.type !== 'Identifier' || typeof binding.name !== 'string') return false;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (scope?.bindings.has(binding.name)) return scope.symbolBindings.has(binding.name);
  }
  return false;
}
