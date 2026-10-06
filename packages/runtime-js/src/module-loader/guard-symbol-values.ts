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

// ---------------------------------------------------------------------------
// Whole-program Symbol-mutation pre-scan. Runs BEFORE the exemption walk, so
// a mutation ANYWHERE (later line, nested function) invalidates every
// Symbol-key proof in the module — the ceiling stays whole (ADR-0171).
// ---------------------------------------------------------------------------

type PoisonNode = { readonly type?: string; readonly [key: string]: unknown };

function nameOf(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  return (node as { name?: unknown }).name as string | undefined;
}

function isIdentifier(node: unknown, name: string): boolean {
  return (
    node !== null &&
    typeof node === 'object' &&
    (node as PoisonNode).type === 'Identifier' &&
    nameOf(node) === name
  );
}

/** `Symbol` / `Symbol.<p>` / `Symbol[...]` / `globalThis.Symbol` targets. */
function isSymbolMutationTarget(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as PoisonNode;
  if (n.type === 'Identifier') return nameOf(n) === 'Symbol';
  if (n.type === 'MemberExpression') {
    const object = n.object;
    if (isIdentifier(object, 'Symbol')) return true;
    // globalThis.Symbol = …
    if (
      isIdentifier(object, 'globalThis') &&
      (n.property !== null && typeof n.property === 'object' ? nameOf(n.property) : undefined) ===
        'Symbol'
    ) {
      return true;
    }
    return isSymbolMutationTarget(object);
  }
  return false;
}

function visitPoison(node: unknown, out: { poisoned: boolean }): void {
  if (out.poisoned || node === null || typeof node !== 'object') return;
  const n = node as PoisonNode;
  if (typeof n.type !== 'string') return;
  switch (n.type) {
    case 'AssignmentExpression':
    case 'UpdateExpression':
      if (isSymbolMutationTarget(n.left ?? n.argument)) out.poisoned = true;
      break;
    case 'UnaryExpression':
      if (n.operator === 'delete' && isSymbolMutationTarget(n.argument)) out.poisoned = true;
      break;
    case 'CallExpression': {
      const callee = n.callee;
      if (
        callee !== null &&
        typeof callee === 'object' &&
        (callee as PoisonNode).type === 'MemberExpression'
      ) {
        const call = callee as PoisonNode;
        const object = call.object;
        const prop =
          call.property !== null && typeof call.property === 'object'
            ? nameOf(call.property)
            : undefined;
        const args = Array.isArray(n.arguments) ? (n.arguments as unknown[]) : [];
        const first = args[0];
        // Object.defineProperty/defineProperties/assign or Reflect.set/defineProperty
        if (
          (isIdentifier(object, 'Object') &&
            (prop === 'defineProperty' || prop === 'defineProperties' || prop === 'assign')) ||
          (isIdentifier(object, 'Reflect') && (prop === 'set' || prop === 'defineProperty'))
        ) {
          if (isIdentifier(first, 'Symbol')) out.poisoned = true;
        }
      }
      break;
    }
    case 'ClassDeclaration':
    case 'FunctionDeclaration':
      // A top-level declaration named `Symbol` shadows the global identifier
      // for module code (checked by the caller for top level only).
      if (nameOf(n.id) === 'Symbol') out.poisoned = true;
      break;
    default:
      break;
  }
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue;
    }
    const value = n[key];
    if (Array.isArray(value)) {
      for (const item of value) visitPoison(item, out);
    } else if (value !== null && typeof value === 'object') {
      visitPoison(value, out);
    }
  }
}

/**
 * True when the program (or its top-level declarations named `Symbol`)
 * contains ANY shape that can replace `Symbol.for`/`Symbol` — making every
 * Symbol-key exemption unprovable in that module. Conservative by design:
 * over-rejecting keeps the ADR-0171 ceiling whole; never silently weakens it.
 * `topLevelBody` supplies the module-scope declaration check.
 */
export function programPoisonsSymbolProofs(
  program: unknown,
  topLevelBody: readonly unknown[],
): boolean {
  const out = { poisoned: false };
  for (const child of topLevelBody) {
    if (child !== null && typeof child === 'object') {
      const c = child as PoisonNode;
      let decl = c;
      if (c.type === 'ExportNamedDeclaration' || c.type === 'ExportDefaultDeclaration') {
        const inner = c.declaration;
        if (inner !== null && typeof inner === 'object') decl = inner as PoisonNode;
      }
      if (
        (decl.type === 'ClassDeclaration' || decl.type === 'FunctionDeclaration') &&
        nameOf(decl.id) === 'Symbol'
      ) {
        out.poisoned = true;
      }
    }
  }
  if (!out.poisoned) visitPoison(program, out);
  return out.poisoned;
}
