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
  readonly symbolIntrinsicAliases: Set<string>;
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

// A computed (or nested) member's OBJECT is fixed before the key interior
// evaluates; a key/argument interior that rebinds the alias must not
// re-classify the captured object (R6 F2). The twins record this at the
// member's own walk point, keyed by the member node; consumers that run
// after the subtree walk read the capture instead of re-deriving live.
export interface MemberObjectCapture {
  readonly raw: boolean; // isGlobalObjectExpression parity (Function guard)
  readonly unwrapped: boolean; // unwrapping probe (Symbol-tamper arm)
}

// Undefined when the member was never walked (no capture point) — the
// caller falls back to the live classification.
export type MemberObjectCaptureProbe = (member: unknown) => MemberObjectCapture | undefined;

// Records the member's object classification at the member's own walk
// point (R6 F2) — a later key/argument interior may rebind the alias.
export function recordMemberObjectCapture(
  captures: Map<unknown, MemberObjectCapture>,
  member: unknown,
  object: unknown,
  isGlobalObjectRaw: SymbolKeyGlobalProbe,
  isGlobalObject: SymbolKeyGlobalProbe,
): void {
  captures.set(member, { raw: isGlobalObjectRaw(object), unwrapped: isGlobalObject(object) });
}

// The Function-guard write arm over a member target whose object was
// already classified at its own evaluation point (R5b F2): a static
// 'Function' key, or a computed key that is not provably Symbol.
export function isGlobalFunctionWriteMember(
  node: unknown,
  objectIsGlobal: boolean,
  scopes: readonly SymbolKeyScope[],
  isShadowedProvability: SymbolKeyShadowProbe,
  withDepth = 0,
): boolean {
  if (!objectIsGlobal) return false;
  const propertyName = staticPropertyName(node as GuardAstNode);
  if (propertyName !== undefined) return propertyName === 'Function';
  if (!isComputedMember(node as GuardAstNode)) return false;
  const property = (node as unknown as { property?: unknown }).property;
  return !isProvablySymbolKey(property, scopes, isShadowedProvability, withDepth);
}

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
// call it for const declarators only, so no unmark path is needed. Marks
// BOTH alias kinds: a provable Symbol KEY (`const K = Symbol.for(…)`) and
// the INTRINSIC itself (`const S = Symbol`, `const S = globalThis.Symbol` —
// tamper detection only, the proof never accepts alias callees).
export function updateSymbolAliasesFromPatternValue(
  scopes: readonly SymbolKeyScope[],
  pattern: unknown,
  value: unknown,
  isShadowed: SymbolKeyShadowProbe,
  isGlobalObject: SymbolKeyGlobalProbe,
  memberCapture?: MemberObjectCaptureProbe,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardAstNode;
  if (pat.type !== 'Identifier') return;
  const name = (pat as unknown as { name?: string }).name;
  if (isProvablySymbolKey(value, scopes, isShadowed)) {
    markSymbolKeyAlias(scopes, name);
  }
  if (!value || typeof value !== 'object') return;
  const v = unwrapGuardChain(value) as GuardAstNode;
  const isIntrinsic =
    (v.type === 'Identifier' &&
      (((v as unknown as { name?: string }).name === 'Symbol' && !isShadowed('Symbol')) ||
        isSymbolIntrinsicAlias(scopes, (v as unknown as { name?: string }).name as string))) ||
    (v.type === 'MemberExpression' &&
      // The member's object was classified at its own evaluation point
      // (R6 F2) — the init walk may have rebound the alias since.
      (memberCapture?.(v)?.unwrapped ??
        isGlobalObject((v as unknown as { object?: unknown }).object)) &&
      staticPropertyName(v) === 'Symbol');
  if (isIntrinsic) markSymbolIntrinsicAlias(scopes, name);
}

// const-bound alias of the INTRINSIC ITSELF (`const S = Symbol`) — tracked
// for TAMPER detection only (a write `S.for = …` substitutes the real
// intrinsic); the provable-key proof does NOT accept alias callees (no
// claimed evidence needs them). Same const-only/no-fallback discipline as
// the key aliases; let/var aliases stay untracked (reassignment makes them
// may-alias — the exhaustive metaprogramming ceiling's).
export function markSymbolIntrinsicAlias(
  scopes: readonly SymbolKeyScope[],
  name: string | undefined,
): void {
  if (!name) return;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!scope?.bindings.has(name)) continue;
    scope.symbolIntrinsicAliases.add(name);
    return;
  }
}

export function isSymbolIntrinsicAlias(scopes: readonly SymbolKeyScope[], name: string): boolean {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!scope?.bindings.has(name)) continue;
    return scope.symbolIntrinsicAliases.has(name);
  }
  return false;
}

// A computed key is provably Symbol-valued when it is a
// Symbol(...)/Symbol.for(...) call on an unshadowed Symbol, or an Identifier
// const-bound to one. Symbol.keyFor returns a string — NOT accepted; a
// shadowed Symbol keeps every pattern loud. Inside a CJS `with` body NO key
// is provable: the dynamic scope may shadow the alias or Symbol itself with
// a string (R4 F4); ESM is strict-parsed, so it never passes withDepth.
export function isProvablySymbolKey(
  node: unknown,
  scopes: readonly SymbolKeyScope[],
  isShadowed: SymbolKeyShadowProbe,
  withDepth = 0,
): boolean {
  if (withDepth > 0) return false;
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
  withDepth = 0,
): boolean {
  return propertyMayBeFunction(node) && !isProvablySymbolKey(node, scopes, isShadowed, withDepth);
}

// The intrinsic is reachable two ways: the unshadowed `Symbol` identifier,
// or `globalThis.Symbol` / `globalThis['Symbol']` — the global form names
// the real intrinsic even when a local binding shadows the identifier
// (Final+GREEN R2 F1). Sequence/paren chains unwrap: `(0, Symbol).for`
// reads the same intrinsic (R3 F2).
function isSymbolReference(
  node: unknown,
  scopes: readonly SymbolKeyScope[],
  isShadowed: SymbolKeyShadowProbe,
  isGlobalObject: SymbolKeyGlobalProbe,
  memberCapture?: MemberObjectCaptureProbe,
): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapGuardChain(node) as GuardAstNode;
  if (typeof n.type !== 'string') return false;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return (
      (name === 'Symbol' && !isShadowed('Symbol')) ||
      (typeof name === 'string' && isSymbolIntrinsicAlias(scopes, name))
    );
  }
  if (n.type !== 'MemberExpression') return false;
  const object = (n as unknown as { object?: unknown }).object;
  // The member's own capture fixes its object classification at the
  // object's evaluation point (R6 F2); live derivation only when the
  // member was never walked.
  const objectIsGlobal = memberCapture?.(n)?.unwrapped ?? isGlobalObject(object);
  return objectIsGlobal && staticPropertyName(n) === 'Symbol';
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
  scopes: readonly SymbolKeyScope[],
  isShadowed: SymbolKeyShadowProbe,
  isGlobalObject: SymbolKeyGlobalProbe,
  memberCapture?: MemberObjectCaptureProbe,
): boolean {
  if (!target || typeof target !== 'object') return false;
  const t = unwrapGuardChain(target) as GuardAstNode;
  if (t.type === 'Identifier') {
    const name = (t as unknown as { name?: string }).name;
    return (
      (name === 'Symbol' && !isShadowed('Symbol')) ||
      (typeof name === 'string' && isSymbolIntrinsicAlias(scopes, name))
    );
  }
  if (t.type !== 'MemberExpression') return false;
  const object = (t as unknown as { object?: unknown }).object as GuardAstNode | undefined;
  if (isSymbolReference(object, scopes, isShadowed, isGlobalObject, memberCapture)) return true;
  return isGlobalObject(object) && staticPropertyName(t) === 'Symbol';
}

// ---------------------------------------------------------------------------
// Evaluation-order capture (Final+GREEN R5b F1/F2): every reference at a
// mutation call site is classified at its OWN evaluation point — the callee
// object after the callee walk, the target argument after its walk, the key
// after its walk. A later argument interior may rebind an alias or
// substitute the intrinsic, but JS has already fixed the earlier reference:
// classifying it post-walk flipped captured-global writes to silent and
// captured-local writes to loud (F2), and setting the site's own tamper flag
// before its interior walk rejected a nested write that runs BEFORE the
// substitution (F1). The caller applies the flags after the walk returns.
// ---------------------------------------------------------------------------

export interface MutationSiteCapture {
  calleeObjectIsGlobal: boolean; // raw callee.object — the Function-guard arm
  calleeObjectIsGlobalUnwrapped: boolean; // unwrapped — the Symbol-tamper arm
  calleeObjectIsSymbol: boolean;
  targetIsGlobal: boolean; // raw args[0]
  targetIsGlobalUnwrapped: boolean;
  targetIsSymbol: boolean;
  getterKeyMayBeFunction: boolean; // args[0] as the __defineGetter__ key
  keyMayBeFunction: boolean; // args[1] as the define/Reflect key
  sourcesMayContainFunctionKey: boolean; // assign/defineProperties sources
}

export interface MutationSiteProbes {
  // Lexical shadowing only — tamper detection and builtin-name checks (the
  // augmented probe's flag/withDepth disjuncts would excuse real
  // substitution, R5).
  readonly isShadowed: SymbolKeyShadowProbe;
  // Augmented (tamper-flag/withDepth-aware) — key provability proofs.
  readonly isShadowedProvability: SymbolKeyShadowProbe;
  readonly isGlobalObject: SymbolKeyGlobalProbe; // unwrapping
  readonly isGlobalObjectRaw: SymbolKeyGlobalProbe; // Function-guard parity
  // Per-member object classifications recorded at each member's own walk
  // point (R6 F2) — the callee object is read from here, never re-derived
  // after the key/argument interior may have rebound the alias.
  readonly memberObjectCapture: MemberObjectCaptureProbe;
}

// Walks the callee and the arguments exactly once, in source order,
// capturing each classification at its own evaluation point. The site
// predicates then read the capture; the tamper flag is applied by the caller
// only after the whole interior was walked (the call executes last).
export function walkMutationCallSite(
  node: unknown,
  walk: (node: unknown) => void,
  scopes: readonly SymbolKeyScope[],
  probes: MutationSiteProbes,
  withDepth = 0,
): MutationSiteCapture {
  const call = node as unknown as { callee?: GuardAstNode; arguments?: unknown[] };
  const callee = call.callee;
  const args = call.arguments ?? [];
  const capture: MutationSiteCapture = {
    calleeObjectIsGlobal: false,
    calleeObjectIsGlobalUnwrapped: false,
    calleeObjectIsSymbol: false,
    targetIsGlobal: false,
    targetIsGlobalUnwrapped: false,
    targetIsSymbol: false,
    getterKeyMayBeFunction: true,
    keyMayBeFunction: true,
    sourcesMayContainFunctionKey: false,
  };
  walk(callee);
  const rawCalleeObject =
    callee?.type === 'MemberExpression'
      ? (callee as unknown as { object?: unknown }).object
      : undefined;
  const calleeObject = unwrapGuardChain(rawCalleeObject) as GuardAstNode | undefined;
  // The callee member's own capture fixes its object classification at the
  // object's evaluation point — a computed-key interior that rebinds the
  // alias must not re-classify it (R6 F2).
  const calleeCapture = probes.memberObjectCapture(callee);
  capture.calleeObjectIsGlobal = calleeCapture?.raw ?? probes.isGlobalObjectRaw(rawCalleeObject);
  capture.calleeObjectIsGlobalUnwrapped =
    calleeCapture?.unwrapped ?? probes.isGlobalObject(calleeObject);
  capture.calleeObjectIsSymbol = isSymbolReference(
    calleeObject,
    scopes,
    probes.isShadowed,
    probes.isGlobalObject,
    probes.memberObjectCapture,
  );
  const objectName =
    calleeObject?.type === 'Identifier'
      ? (calleeObject as unknown as { name?: string }).name
      : undefined;
  const propertyName = callee ? staticPropertyName(callee) : undefined;
  const isAssign =
    objectName === 'Object' && !probes.isShadowed('Object') && propertyName === 'assign';
  const isDefineProperties =
    objectName === 'Object' && !probes.isShadowed('Object') && propertyName === 'defineProperties';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((isAssign && i >= 1) || (isDefineProperties && i === 1)) {
      walkSourceArgument(arg, capture, walk, scopes, probes, withDepth);
      continue;
    }
    walk(arg);
    if (i === 0) {
      capture.targetIsGlobal = probes.isGlobalObjectRaw(arg);
      capture.targetIsGlobalUnwrapped = probes.isGlobalObject(arg);
      capture.targetIsSymbol = isSymbolReference(
        arg,
        scopes,
        probes.isShadowed,
        probes.isGlobalObject,
      );
      capture.getterKeyMayBeFunction = mutationKeyMayBeFunction(
        arg,
        scopes,
        probes.isShadowedProvability,
        withDepth,
      );
    } else if (i === 1) {
      capture.keyMayBeFunction = mutationKeyMayBeFunction(
        arg,
        scopes,
        probes.isShadowedProvability,
        withDepth,
      );
    }
  }
  // `Object.defineProperties(g)` with no source argument is conservative,
  // mirroring objectMayContainFunctionKey(undefined).
  if (isDefineProperties && args.length < 2) capture.sourcesMayContainFunctionKey = true;
  return capture;
}

// defineProperties/Object.assign source object: each computed key is proven
// right after ITS walk — a tamper inside a later value must not poison an
// earlier-evaluated key (R5b F1). Non-literal sources stay conservative.
function walkSourceArgument(
  arg: unknown,
  capture: MutationSiteCapture,
  walk: (node: unknown) => void,
  scopes: readonly SymbolKeyScope[],
  probes: MutationSiteProbes,
  withDepth: number,
): void {
  if (!arg || typeof arg !== 'object' || (arg as GuardAstNode).type !== 'ObjectExpression') {
    walk(arg);
    capture.sourcesMayContainFunctionKey = true;
    return;
  }
  const properties = (arg as unknown as { properties?: GuardAstNode[] }).properties ?? [];
  for (const property of properties) {
    if (property.type === 'SpreadElement') {
      walk((property as unknown as { argument?: unknown }).argument);
      capture.sourcesMayContainFunctionKey = true;
      continue;
    }
    const p = property as unknown as { computed?: boolean; key?: unknown; value?: unknown };
    if (p.computed) {
      walk(p.key);
      // A statically-known string key keeps the pre-capture safe-key
      // disjunct (R6 F4): only 'Function' flags; a non-static key falls to
      // the provable-Symbol proof, taken right after ITS walk (R5b F1).
      const keyName = staticPropertyKeyName(property);
      if (keyName === undefined) {
        if (!isProvablySymbolKey(p.key, scopes, probes.isShadowedProvability, withDepth)) {
          capture.sourcesMayContainFunctionKey = true;
        }
      } else if (keyName === 'Function') {
        capture.sourcesMayContainFunctionKey = true;
      }
      walk(p.value);
      continue;
    }
    const keyName = staticPropertyKeyName(property);
    if (keyName === undefined || keyName === 'Function') {
      capture.sourcesMayContainFunctionKey = true;
    }
    walk(property);
  }
}

// The Function-ceiling site predicate over the capture: the defineProperty/
// Reflect.set/deleteProperty/__defineGetter__ key positions and the
// assign/defineProperties source objects on a captured-global target.
export function isGlobalFunctionMutationCall(
  node: unknown,
  capture: MutationSiteCapture,
  isShadowed: SymbolKeyShadowProbe,
): boolean {
  const call = node as unknown as { callee?: GuardAstNode };
  const callee = call.callee;
  if (!callee || callee.type !== 'MemberExpression') return false;
  const object = (callee as unknown as { object?: GuardAstNode }).object;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  const propertyName = staticPropertyName(callee);
  const isBuiltinObject = objectName === 'Object' && !isShadowed('Object');
  const isBuiltinReflect = objectName === 'Reflect' && !isShadowed('Reflect');
  if (isBuiltinObject && propertyName === 'assign' && capture.targetIsGlobal) {
    return capture.sourcesMayContainFunctionKey;
  }
  const isObjectDefine =
    isBuiltinObject && (propertyName === 'defineProperty' || propertyName === 'defineProperties');
  const isReflectMutation =
    isBuiltinReflect &&
    (propertyName === 'defineProperty' ||
      propertyName === 'set' ||
      propertyName === 'deleteProperty');
  if ((isObjectDefine || isReflectMutation) && capture.targetIsGlobal) {
    return propertyName === 'defineProperties'
      ? capture.sourcesMayContainFunctionKey
      : capture.keyMayBeFunction;
  }
  if (
    capture.calleeObjectIsGlobal &&
    (propertyName === '__defineGetter__' || propertyName === '__defineSetter__')
  ) {
    return capture.getterKeyMayBeFunction;
  }
  return false;
}

// The defineProperty-family twin of isSymbolTamperTarget, over the capture:
// `Object.defineProperty(Symbol, 'for', …)` & friends substitute the
// intrinsic without an assignment target, and a literal 'Symbol' key through
// the global object (`Object.defineProperty(globalThis, 'Symbol', …)`,
// `Reflect.set(globalThis, 'Symbol', …)`, an assign/defineProperties literal
// `Symbol:` key) slips the Function guard — unknown keys on globalThis are
// already ceiling-loud, so only the literal 'Symbol' forms need flagging.
export function isSymbolIntrinsicMutationCall(
  node: unknown,
  capture: MutationSiteCapture,
  isShadowed: SymbolKeyShadowProbe,
): boolean {
  const call = node as unknown as { callee?: GuardAstNode; arguments?: unknown[] };
  // Wrapped callees name the same builtin: `(0, Object).defineProperty` IS
  // Object.defineProperty (R4 F3 — the unwrap must reach callee AND object).
  const callee = unwrapGuardChain(call.callee) as GuardAstNode | undefined;
  const args = call.arguments ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const object = unwrapGuardChain((callee as unknown as { object?: GuardAstNode }).object) as
    | GuardAstNode
    | undefined;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  const propertyName = staticPropertyName(callee);
  if (
    capture.calleeObjectIsSymbol &&
    (propertyName === '__defineGetter__' || propertyName === '__defineSetter__')
  ) {
    return true;
  }
  // `globalThis.__defineGetter__('Symbol', …)` installs a getter for the
  // intrinsic slot through the global object (Final+GREEN R2 F1).
  if (
    capture.calleeObjectIsGlobalUnwrapped &&
    (propertyName === '__defineGetter__' || propertyName === '__defineSetter__')
  ) {
    return literalString(args[0]) === 'Symbol';
  }
  const isBuiltinObject = objectName === 'Object' && !isShadowed('Object');
  const isBuiltinReflect = objectName === 'Reflect' && !isShadowed('Reflect');
  // Prototype injection (R3 F4): `Object.setPrototypeOf(Symbol, {for: …})`
  // installs an inherited 'for' that a later `delete Symbol.for` opens.
  if (
    propertyName === 'setPrototypeOf' &&
    (isBuiltinObject || isBuiltinReflect) &&
    capture.targetIsSymbol
  ) {
    return true;
  }
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
  if (capture.targetIsSymbol) return true;
  if (!capture.targetIsGlobalUnwrapped) return false;
  if (propertyName === 'assign' || propertyName === 'defineProperties') {
    return args.slice(1).some(hasLiteralSymbolKey);
  }
  return literalString(args[1]) === 'Symbol';
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
