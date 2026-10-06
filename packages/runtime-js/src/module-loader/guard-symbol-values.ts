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

/** Conservative source pre-scan: any assignment/deletion of `Symbol` or
 * `Symbol.for` poisons the module's Symbol-key exemptions. */
const SYMBOL_MUTATION_RE =
  /(?:^|[^\w$.])Symbol(?:\s*\.\s*for)?\s*(?:[+\-*/%&|^]|\*\*|<<|>>>?)?=(?!=)|delete\s+Symbol|(?:^|[^\w$.])Object\.defineProperty\s*\(\s*Symbol/u;

export function symbolGuardPoisoned(source: string): boolean {
  return SYMBOL_MUTATION_RE.test(source);
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
