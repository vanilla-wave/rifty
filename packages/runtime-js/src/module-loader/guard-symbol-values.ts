/**
 * Guard precision for provably-Symbol computed keys
 * (symbol-key-global-write-guard-precision): a key bound (const, same scope)
 * to a `Symbol()`/`Symbol.for()` value or a well-known `Symbol.<name>` member
 * is provably never the string 'Function', so a `globalThis[key]` write
 * through it is not a Function mutation (@vitest/utils, undici shapes).
 * Shared by the ESM and CJS Function write guards.
 */

/** Minimal scope surface the shared helpers need from either guard context. */
export interface SymbolValueScope {
  readonly bindings: ReadonlySet<string>;
  readonly symbolValueBindings: ReadonlySet<string>;
}

/** Minimal ctx surface (esm.ts and cjs.ts satisfy this via an adapter). */
export interface SymbolGuardContext {
  readonly scopes: readonly (SymbolValueScope | undefined)[];
  isShadowed(name: string): boolean;
  staticPropertyName(node: unknown): string | undefined;
  /** The module reassigns `Symbol`/`Symbol.for` somewhere — nothing is provable. */
  readonly symbolMutated?: boolean;
}

function nodeName(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  return (node as { name?: unknown }).name as string | undefined;
}

/** True for `Symbol(...)` / `Symbol.for(...)` / `Symbol.<well-known>` shapes. */
export function isProvablySymbolValueExpression(node: unknown, ctx: SymbolGuardContext): boolean {
  if (ctx.symbolMutated === true) return false;
  if (!node || typeof node !== 'object') return false;
  const type = (node as { type?: unknown }).type;
  if (type === 'CallExpression') {
    const callee = (node as { callee?: unknown }).callee;
    const calleeType =
      callee !== null && typeof callee === 'object'
        ? (callee as { type?: unknown }).type
        : undefined;
    if (calleeType === 'Identifier') {
      return nodeName(callee) === 'Symbol' && !ctx.isShadowed('Symbol');
    }
    if (calleeType === 'MemberExpression') {
      return (
        nodeName((callee as { object?: unknown }).object) === 'Symbol' &&
        !ctx.isShadowed('Symbol') &&
        ctx.staticPropertyName(callee) === 'for'
      );
    }
    return false;
  }
  // `Symbol.<name>` member expressions are NOT provable — the Symbol object
  // can carry arbitrary STRING properties (guard review finding).
  return false;
}

/** A computed key provably never `'Function'`: Symbol-bound identifier or a
 * direct provably-Symbol expression. */
export function computedKeyProvablyNotFunction(node: unknown, ctx: SymbolGuardContext): boolean {
  if (!node || typeof node !== 'object') return false;
  if ((node as { type?: unknown }).type === 'Identifier') {
    const name = nodeName(node);
    if (typeof name !== 'string') return false;
    for (let i = ctx.scopes.length - 1; i >= 0; i--) {
      const scope = ctx.scopes[i];
      if (!scope?.bindings.has(name)) continue;
      return scope.symbolValueBindings.has(name);
    }
    return false;
  }
  return isProvablySymbolValueExpression(node, ctx);
}

// ---------------------------------------------------------------------------
// Whole-program Symbol-mutation pre-scan. Runs BEFORE the exemption walk, so
// a mutation ANYWHERE (later line, nested function) invalidates every
// Symbol-key proof in the module — the ceiling stays whole (ADR-0171).
// ---------------------------------------------------------------------------

type PoisonNode = { readonly type?: string; readonly [key: string]: unknown };

/**
 * DECISIVE narrow exemption (re-cut 2026-10-06): the analyzer accepts ONLY
 * the two claimed shapes — a module-top-level `const X = Symbol('<literal>')`
 * or `const X = Symbol.for('<literal>')` — and ONLY when the identifier
 * `Symbol` appears NOWHERE ELSE in the module (every other occurrence —
 * alias, parameter, shadow, mutation, second reference — poisons). This is
 * decidable in one pass and cannot be weakened by any static shape the
 * reviewers enumerated; the ceiling (ADR-0171) stays whole everywhere else.
 */

function countIdentifierOccurrences(program: unknown, name: string): number {
  let count = 0;
  const scan = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as PoisonNode;
    if (typeof n.type !== 'string') return;
    if (n.type === 'Identifier' && (n as { name?: unknown }).name === name) count += 1;
    for (const key of Object.keys(n)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
        continue;
      }
      const value = n[key];
      if (Array.isArray(value)) {
        for (const item of value) scan(item);
      } else if (value !== null && typeof value === 'object') {
        scan(value);
      }
    }
  };
  scan(program);
  return count;
}

/** `const X = Symbol('lit')` / `const X = Symbol.for('lit')` at module top
 * level; returns the identifiers bound by such declarators. */
function literalSymbolConstNames(topLevelBody: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const raw of topLevelBody) {
    if (raw === null || typeof raw !== 'object') continue;
    let n = raw as PoisonNode;
    if (n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') {
      const inner = n.declaration;
      if (inner === null || typeof inner !== 'object') continue;
      n = inner as PoisonNode;
    }
    if (n.type !== 'VariableDeclaration' || n.kind !== 'const') continue;
    for (const decl of (n.declarations as unknown[]) ?? []) {
      const d = decl as PoisonNode;
      const init = d.init;
      if (init === null || typeof init !== 'object') continue;
      const call = init as PoisonNode;
      if (call.type !== 'CallExpression') continue;
      const callee = call.callee as PoisonNode | null;
      if (callee === null || typeof callee !== 'object') continue;
      let isFactory = false;
      if (callee.type === 'Identifier' && callee.name === 'Symbol') isFactory = true;
      if (callee.type === 'MemberExpression') {
        const obj = callee.object as PoisonNode | null;
        const prop = callee.property as PoisonNode | null;
        if (
          obj !== null &&
          typeof obj === 'object' &&
          obj.type === 'Identifier' &&
          obj.name === 'Symbol' &&
          prop !== null &&
          typeof prop === 'object' &&
          (prop as { name?: unknown }).name === 'for'
        ) {
          isFactory = true;
        }
      }
      if (!isFactory) continue;
      // Literal argument only — dynamic arguments stay unproven.
      const arg = (call.arguments as unknown[] | undefined)?.[0];
      if (arg === null || typeof arg !== 'object') continue;
      if (
        (arg as PoisonNode).type !== 'Literal' ||
        typeof (arg as { value?: unknown }).value !== 'string'
      ) {
        continue;
      }
      const id = d.id as PoisonNode | null;
      if (id !== null && typeof id === 'object' && id.type === 'Identifier') {
        out.add(String(id.name));
      }
    }
  }
  return out;
}

/**
 * True when the module is NOT eligible for the narrow Symbol-key exemption:
 * either no qualifying const factory binding exists, or `Symbol` occurs more
 * often than those factories use it (any alias/mutation/second reference).
 */
export function programPoisonsSymbolProofs(
  program: unknown,
  topLevelBody: readonly unknown[],
): boolean {
  const bound = literalSymbolConstNames(topLevelBody);
  if (bound.size === 0) return true;
  const occurrences = countIdentifierOccurrences(program, 'Symbol');
  // Each qualifying factory consumes exactly one `Symbol` identifier.
  return occurrences !== bound.size;
}
