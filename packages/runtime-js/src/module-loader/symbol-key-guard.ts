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
  literalString,
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

/**
 * Same shape as the twins' isGuardShadowed/isShadowed, bound to their ctx —
 * plus one disjunct the twins add: once the module observably tampers the
 * Symbol intrinsic, 'Symbol' reports as shadowed, so every provable-key
 * pattern goes loud (F1: lexical unshadowed ≠ unchanged intrinsic).
 */
export type SymbolKeyShadowProbe = (name: string) => boolean;

/** Same shape as the twins' isGlobalObjectExpression, bound to their ctx. */
export type SymbolKeyGlobalProbe = (node: unknown) => boolean;

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

// The intrinsic is reachable two ways: the unshadowed `Symbol` identifier,
// or `globalThis.Symbol` / `globalThis['Symbol']` — the global form names
// the real intrinsic even when a local binding shadows the identifier
// (Final+GREEN R2 F1).
function isSymbolReference(
  node: unknown,
  isShadowed: SymbolKeyShadowProbe,
  isGlobalObject: SymbolKeyGlobalProbe,
): boolean {
  const n = node as GuardAstNode | undefined | null;
  if (!n || typeof n.type !== 'string') return false;
  if (n.type === 'Identifier') {
    return (n as unknown as { name?: string }).name === 'Symbol' && !isShadowed('Symbol');
  }
  if (n.type !== 'MemberExpression') return false;
  const object = (n as unknown as { object?: unknown }).object;
  return isGlobalObject(object) && staticPropertyName(n) === 'Symbol';
}

// F1 tamper detection: an explicitly observable substitution of the Symbol
// intrinsic — bare assignment (`Symbol = …`), a member write/delete on it
// (`Symbol.for = …`, `globalThis.Symbol.for = …`), or a write/delete of
// `globalThis.Symbol` — means a later `Symbol.for(...)` may return any
// string, so the module keeps the loud path. Source-ordered like the
// twins' existing alias trackers; a shadowed (locally bound) Symbol is a
// local, never tamper.
export function isSymbolTamperTarget(
  target: unknown,
  isShadowed: SymbolKeyShadowProbe,
  isGlobalObject: SymbolKeyGlobalProbe,
): boolean {
  if (!target || typeof target !== 'object') return false;
  const t = target as GuardAstNode;
  if (t.type === 'Identifier') {
    return (t as unknown as { name?: string }).name === 'Symbol' && !isShadowed('Symbol');
  }
  if (t.type !== 'MemberExpression') return false;
  const object = (t as unknown as { object?: unknown }).object as GuardAstNode | undefined;
  if (isSymbolReference(object, isShadowed, isGlobalObject)) return true;
  return isGlobalObject(object) && staticPropertyName(t) === 'Symbol';
}

// The defineProperty-family twin of isSymbolTamperTarget:
// `Object.defineProperty(Symbol, 'for', …)` & friends substitute the
// intrinsic without an assignment target, and a literal 'Symbol' key through
// the global object (`Object.defineProperty(globalThis, 'Symbol', …)`,
// `Reflect.set(globalThis, 'Symbol', …)`, an assign/defineProperties literal
// `Symbol:` key) slips the Function guard — unknown keys on globalThis are
// already ceiling-loud, so only the literal 'Symbol' forms need flagging.
export function isSymbolIntrinsicMutationCall(
  node: GuardAstNode,
  isShadowed: SymbolKeyShadowProbe,
  isGlobalObject: SymbolKeyGlobalProbe,
): boolean {
  const call = node as unknown as { callee?: GuardAstNode; arguments?: unknown[] };
  const callee = call.callee;
  const args = call.arguments ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const object = (callee as unknown as { object?: GuardAstNode }).object;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  const propertyName = staticPropertyName(callee);
  if (
    isSymbolReference(object, isShadowed, isGlobalObject) &&
    (propertyName === '__defineGetter__' || propertyName === '__defineSetter__')
  ) {
    return true;
  }
  // `globalThis.__defineGetter__('Symbol', …)` installs a getter for the
  // intrinsic slot through the global object (Final+GREEN R2 F1).
  if (
    isGlobalObject(object) &&
    (propertyName === '__defineGetter__' || propertyName === '__defineSetter__')
  ) {
    return literalString(args[0]) === 'Symbol';
  }
  const isBuiltinObject = objectName === 'Object' && !isShadowed('Object');
  const isBuiltinReflect = objectName === 'Reflect' && !isShadowed('Reflect');
  const isDefineFamily =
    (isBuiltinObject &&
      (propertyName === 'assign' ||
        propertyName === 'defineProperty' ||
        propertyName === 'defineProperties')) ||
    (isBuiltinReflect &&
      (propertyName === 'set' ||
        propertyName === 'defineProperty' ||
        propertyName === 'deleteProperty'));
  if (!isDefineFamily) return false;
  if (isSymbolReference(args[0], isShadowed, isGlobalObject)) return true;
  if (!isGlobalObject(args[0])) return false;
  if (propertyName === 'assign' || propertyName === 'defineProperties') {
    return args.slice(1).some(hasLiteralSymbolKey);
  }
  return literalString(args[1]) === 'Symbol';
}

// F2 (Final+GREEN R2): a mutation key evaluates BEFORE the write/call
// completes, so a tamper carrier nested anywhere inside the key expression
// (`globalThis[(Symbol.for = …, Symbol.for('x'))] = v`, the Reflect.set /
// defineProperty key arg, an Object.assign literal computed key) runs first
// — the sequence unwrap must not discard it. Scan the key interior and flip
// the tamper flag before the proof is consulted. Assignment and
// defineProperty-family calls suffice: UpdateExpression/delete on Symbol
// cannot substitute the intrinsic (NaN/TypeError, no evasion).
export function commitKeyExpressionTamper(
  node: unknown,
  isShadowed: SymbolKeyShadowProbe,
  isGlobalObject: SymbolKeyGlobalProbe,
  markTampered: () => void,
): void {
  const visit = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const current = n as GuardAstNode & Record<string, unknown>;
    if (typeof current.type !== 'string') return;
    if (
      (current.type === 'AssignmentExpression' &&
        isSymbolTamperTarget(
          (current as unknown as { left?: unknown }).left,
          isShadowed,
          isGlobalObject,
        )) ||
      (current.type === 'CallExpression' &&
        isSymbolIntrinsicMutationCall(current, isShadowed, isGlobalObject))
    ) {
      markTampered();
    }
    for (const value of Object.values(current)) {
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else {
        visit(value);
      }
    }
  };
  visit(node);
}

// Only literal `Symbol:` keys count — a non-literal/unknown key on the
// global object is already Function-ceiling loud, so the tamper flag would
// change nothing.
function hasLiteralSymbolKey(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const object = node as GuardAstNode;
  if (object.type !== 'ObjectExpression') return false;
  const properties = (object as unknown as { properties?: GuardAstNode[] }).properties ?? [];
  return properties.some(
    (property) => property.type !== 'SpreadElement' && staticPropertyKeyName(property) === 'Symbol',
  );
}
