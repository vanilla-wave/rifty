/**
 * Shared static-analysis helpers for the Function-assignment/eval guard twins
 * (esm.ts, cjs.ts). Extracted verbatim from the twins (bodies were identical
 * modulo the node-type name) so the symbol-key-guard machinery and both
 * twins consult one copy.
 */

export interface GuardAstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

export function unwrapGuardChain(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as GuardAstNode;
  if (n.type === 'ChainExpression') return unwrapGuardChain(n.expression);
  if (n.type === 'SequenceExpression') {
    const expressions = (n as unknown as { expressions?: unknown[] }).expressions ?? [];
    return unwrapGuardChain(expressions[expressions.length - 1]);
  }
  return node;
}

export function literalString(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = unwrapGuardChain(node) as GuardAstNode;
  if (n.type === 'Literal') {
    const value = (n as unknown as { value?: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }
  if (n.type === 'BinaryExpression' && (n as unknown as { operator?: string }).operator === '+') {
    const left = literalString(n.left);
    const right = literalString(n.right);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  if (n.type === 'TemplateLiteral') {
    const expressions = (n as unknown as { expressions?: unknown[] }).expressions ?? [];
    if (expressions.length > 0) return undefined;
    const quasis = (n as unknown as { quasis?: GuardAstNode[] }).quasis ?? [];
    return quasis
      .map((quasi) => {
        const value = quasi.value as { cooked?: unknown } | undefined;
        return typeof value?.cooked === 'string' ? value.cooked : '';
      })
      .join('');
  }
  return undefined;
}

export function staticPropertyName(node: GuardAstNode): string | undefined {
  const n = unwrapGuardChain(node) as GuardAstNode;
  const member = n as unknown as { computed?: boolean; property?: GuardAstNode };
  const property = member.property;
  if (!property) return undefined;
  if (!member.computed && property.type === 'Identifier') {
    return (property as unknown as { name?: string }).name;
  }
  return member.computed ? literalString(property) : undefined;
}

export function isComputedMember(node: GuardAstNode): boolean {
  return Boolean((unwrapGuardChain(node) as unknown as { computed?: boolean }).computed);
}

export function staticPropertyKeyName(node: GuardAstNode): string | undefined {
  const property = node as unknown as { computed?: boolean; key?: GuardAstNode };
  const key = property.key;
  if (!key) return undefined;
  if (!property.computed && key.type === 'Identifier') {
    return (key as unknown as { name?: string }).name;
  }
  return literalString(key);
}

export function propertyMayBeFunction(node: unknown): boolean {
  const value = literalString(node);
  return value === 'Function' || value === undefined;
}

export function propertyMayBeConstructor(node: unknown): boolean {
  const value = literalString(node);
  return value === 'constructor' || value === undefined;
}
