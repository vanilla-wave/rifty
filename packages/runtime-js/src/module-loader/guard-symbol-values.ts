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

function nameOf(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  return (node as { name?: unknown }).name as string | undefined;
}

/** Static identifier name OR a string-literal computed key (`o['for']`). */
function propertyNameOf(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as PoisonNode;
  if (n.type === 'Identifier') return nameOf(n);
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  return undefined;
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
    // globalThis.Symbol / globalThis['Symbol'] = …
    if (isIdentifier(object, 'globalThis') && propertyNameOf(n.property) === 'Symbol') {
      return true;
    }
    return isSymbolMutationTarget(object);
  }
  return false;
}

/** Names a function-like node binds/shadows in ITS scope (params + locals). */
function scopeShadowedNames(node: PoisonNode): Set<string> {
  const out = new Set<string>();
  const addPattern = (pattern: unknown): void => {
    if (!pattern || typeof pattern !== 'object') return;
    const p = pattern as PoisonNode;
    if (p.type === 'Identifier') out.add(String(p.name));
    else if (p.type === 'RestElement') addPattern(p.argument);
    else if (p.type === 'AssignmentPattern') addPattern(p.left);
    else if (p.type === 'ObjectPattern' || p.type === 'ArrayPattern') {
      const items =
        p.type === 'ObjectPattern'
          ? ((p.properties as unknown[]) ?? []).map((prop) =>
              (prop as PoisonNode).type === 'RestElement'
                ? (prop as PoisonNode).argument
                : (prop as PoisonNode).value,
            )
          : ((p.elements as unknown[]) ?? []);
      for (const item of items) addPattern(item);
    }
  };
  const params = Array.isArray(node.params) ? (node.params as unknown[]) : [];
  for (const param of params) addPattern(param);
  if (node.id !== null && typeof node.id === 'object')
    out.add(String((node.id as PoisonNode).name));
  const body = node.body;
  if (body !== null && typeof body === 'object' && (body as PoisonNode).type === 'BlockStatement') {
    for (const stmt of ((body as PoisonNode).body as unknown[]) ?? []) {
      if (!stmt || typeof stmt !== 'object') continue;
      const st = stmt as PoisonNode;
      if (st.type === 'VariableDeclaration') {
        for (const decl of (st.declarations as unknown[]) ?? []) {
          addPattern((decl as PoisonNode)?.id);
        }
      } else if (
        st.type === 'ClassDeclaration' ||
        st.type === 'FunctionDeclaration' ||
        st.type === 'FunctionExpression'
      ) {
        if (st.id !== null && typeof st.id === 'object')
          out.add(String((st.id as PoisonNode).name));
      }
    }
  }
  return out;
}

const FUNCTION_LIKE = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassDeclaration',
  'ClassExpression',
]);

function visitPoison(
  node: unknown,
  out: { poisoned: boolean },
  shadowed: ReadonlySet<string> = new Set(),
  aliases: ReadonlySet<string> = new Set(),
): void {
  if (out.poisoned || node === null || typeof node !== 'object') return;
  const n = node as PoisonNode;
  if (typeof n.type !== 'string') return;
  let innerShadowed = shadowed;
  let innerAliases = aliases;
  if (FUNCTION_LIKE.has(n.type)) {
    const names = scopeShadowedNames(n as PoisonNode);
    // A local binding named `Symbol` shadows the global identifier INSIDE
    // this scope — mutations there are local, not builtin mutations.
    innerShadowed = new Set([...shadowed, ...names]);
  } else if (n.type === 'VariableDeclaration') {
    for (const decl of (n.declarations as unknown[]) ?? []) {
      const d = decl as PoisonNode;
      if (d === null || typeof d !== 'object') continue;
      const init = d.init;
      // Track simple aliases: const/let X = Symbol (unshadowed here).
      if (
        init !== null &&
        typeof init === 'object' &&
        (init as PoisonNode).type === 'Identifier' &&
        (init as PoisonNode).name === 'Symbol' &&
        !shadowed.has('Symbol') &&
        d.id !== null &&
        typeof d.id === 'object' &&
        (d.id as PoisonNode).type === 'Identifier'
      ) {
        innerAliases = new Set([...aliases, String((d.id as PoisonNode).name)]);
      }
    }
  }
  const symbolish = (id: unknown): boolean =>
    !innerShadowed.has('Symbol') &&
    (isIdentifier(id, 'Symbol') ||
      (innerAliases.size > 0 && FUNCTION_LIKE.size > 0 && isAnyIdentifier(id, innerAliases)));
  switch (n.type) {
    case 'AssignmentExpression':
    case 'UpdateExpression':
      if (isSymbolMutationTargetWith(n.left ?? n.argument, symbolish, innerShadowed))
        out.poisoned = true;
      break;
    case 'UnaryExpression':
      if (
        n.operator === 'delete' &&
        isSymbolMutationTargetWith(n.argument, symbolish, innerShadowed)
      ) {
        out.poisoned = true;
      }
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
        const prop = propertyNameOf(call.property);
        const args = Array.isArray(n.arguments) ? (n.arguments as unknown[]) : [];
        const first = args[0];
        const isObject = isIdentifier(object, 'Object');
        const isReflect = isIdentifier(object, 'Reflect');
        if (
          (isObject &&
            (prop === 'defineProperty' || prop === 'defineProperties' || prop === 'assign')) ||
          (isReflect && (prop === 'set' || prop === 'defineProperty'))
        ) {
          // Direct `Symbol` target OR `globalThis` + 'Symbol' property.
          if (symbolish(first)) out.poisoned = true;
          else if (isIdentifier(first, 'globalThis')) {
            const key = propertyNameOf(args[1]);
            if (key === 'Symbol') out.poisoned = true;
          }
        }
      }
      break;
    }
    default:
      break;
  }
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue;
    }
    const value = n[key];
    if (Array.isArray(value)) {
      for (const item of value) visitPoison(item, out, innerShadowed, innerAliases);
    } else if (value !== null && typeof value === 'object') {
      visitPoison(value, out, innerShadowed, innerAliases);
    }
  }
}

function isAnyIdentifier(node: unknown, names: ReadonlySet<string>): boolean {
  return (
    node !== null &&
    typeof node === 'object' &&
    (node as PoisonNode).type === 'Identifier' &&
    names.has(String((node as PoisonNode).name))
  );
}

function isSymbolMutationTargetWith(
  node: unknown,
  symbolish: (id: unknown) => boolean,
  shadowed: ReadonlySet<string>,
): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as PoisonNode;
  if (n.type === 'Identifier') return symbolish(n);
  if (n.type === 'MemberExpression') {
    const object = n.object;
    if (symbolish(object)) return true;
    if (isIdentifier(object, 'globalThis') && propertyNameOf(n.property) === 'Symbol') return true;
    return isSymbolMutationTargetWith(object, symbolish, shadowed);
  }
  return false;
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
