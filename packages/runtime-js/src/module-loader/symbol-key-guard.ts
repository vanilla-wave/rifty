/**
 * Provably-Symbol computed keys bypass the Function-assignment guard
 * (docs/backlog/runtime-js/symbol-key-global-write-guard-precision.md): a
 * Symbol-valued key can never be the string 'Function' (nor 'eval'), so the
 * @vitest/utils timers stash and undici's globalDispatcher defineProperty
 * must load. Shared by the esm.ts/cjs.ts guard twins — the file-size ratchet
 * pins both twins with a few lines of headroom, so the machinery lives here
 * once (fs-statfs.ts split pattern).
 *
 * MUTATION key positions only. READ sites (the Reflect.get result taint)
 * keep the plain conservative helpers: a Symbol key proves the KEY, never
 * the VALUE — the slot may hold a host Function.
 */
import {
  isComputedMember,
  propertyMayBeFunction,
  staticPropertyKeyName,
  staticPropertyName,
  unwrapGuardChain,
} from './guard-ast.ts';
import type { GuardAstNode } from './guard-ast.ts';

export interface SymbolKeyScope {
  readonly bindings: Set<string>;
  readonly symbolKeyAliases: Set<string>;
}

/** Same shape as the twins' isGuardShadowed/isShadowed, bound to their ctx. */
export type SymbolKeyShadowProbe = (name: string) => boolean;

// const-bound alias to a provable Symbol key; no unmark — const cannot
// reassign, and the twins' addGuardBinding/addBinding clear the mark on
// shadowing. No root fallback: marking a name whose binding was never
// registered would exempt a key whose storage is unknown.
export function markSymbolKeyAlias(
  scopes: readonly SymbolKeyScope[],
  name: string | undefined,
): void {
  if (!name) return;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.symbolKeyAliases.add(name);
    return;
  }
}

export function isSymbolKeyAlias(scopes: readonly SymbolKeyScope[], name: string): boolean {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!scope?.bindings.has(name)) continue;
    return scope.symbolKeyAliases.has(name);
  }
  return false;
}

// Identifier-pattern-only (destructuring/defaults never marked); the twins
// call it for const declarators only, so no unmark path is needed.
export function updateSymbolKeyAliasesFromPatternValue(
  scopes: readonly SymbolKeyScope[],
  pattern: unknown,
  value: unknown,
  isShadowed: SymbolKeyShadowProbe,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardAstNode;
  if (pat.type !== 'Identifier') return;
  if (isProvablySymbolKey(value, scopes, isShadowed)) {
    markSymbolKeyAlias(scopes, (pat as unknown as { name?: string }).name);
  }
}

// A computed key is provably Symbol-valued when it is a
// Symbol(...)/Symbol.for(...) call on an unshadowed Symbol, or an Identifier
// const-bound to one. Symbol.keyFor returns a string — NOT accepted; a
// shadowed Symbol keeps every pattern loud.
export function isProvablySymbolKey(
  node: unknown,
  scopes: readonly SymbolKeyScope[],
  isShadowed: SymbolKeyShadowProbe,
): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapGuardChain(node) as GuardAstNode;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return typeof name === 'string' && isSymbolKeyAlias(scopes, name);
  }
  if (n.type !== 'CallExpression') return false;
  const callee = unwrapGuardChain(n.callee) as GuardAstNode | undefined;
  if (!callee) return false;
  if (callee.type === 'Identifier') {
    const name = (callee as unknown as { name?: string }).name;
    return name === 'Symbol' && !isShadowed('Symbol');
  }
  if (callee.type !== 'MemberExpression') return false;
  if (isComputedMember(callee)) return false;
  const object = unwrapGuardChain((callee as unknown as { object?: unknown }).object) as
    | GuardAstNode
    | undefined;
  if (!object || object.type !== 'Identifier') return false;
  if ((object as unknown as { name?: string }).name !== 'Symbol') return false;
  if (isShadowed('Symbol')) return false;
  return staticPropertyName(callee) === 'for';
}

// Mutation key positions only (defineProperty / Reflect.set /
// Reflect.deleteProperty / __defineGetter__ / __defineSetter__).
export function mutationKeyMayBeFunction(
  node: unknown,
  scopes: readonly SymbolKeyScope[],
  isShadowed: SymbolKeyShadowProbe,
): boolean {
  return propertyMayBeFunction(node) && !isProvablySymbolKey(node, scopes, isShadowed);
}

// defineProperties / Object.assign literal keys.
export function objectMayContainFunctionKey(
  node: unknown,
  scopes: readonly SymbolKeyScope[],
  isShadowed: SymbolKeyShadowProbe,
): boolean {
  if (!node || typeof node !== 'object') return true;
  const object = node as GuardAstNode;
  if (object.type !== 'ObjectExpression') return true;
  const properties = (object as unknown as { properties?: GuardAstNode[] }).properties ?? [];
  return properties.some((property) => {
    if (property.type === 'SpreadElement') return true;
    const key = staticPropertyKeyName(property);
    if (key !== undefined) return key === 'Function';
    const p = property as unknown as { computed?: boolean; key?: unknown };
    return !(p.computed && isProvablySymbolKey(p.key, scopes, isShadowed));
  });
}
