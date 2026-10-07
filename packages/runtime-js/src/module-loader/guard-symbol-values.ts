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

function mutatesMemberRootedAt(node: unknown, name: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as PoisonNode;
  if (n.type === 'MemberExpression') {
    return isIdentifier(n.object, name) || mutatesMemberRootedAt(n.object, name);
  }
  return false;
}

function mutatesNameInside(body: unknown, name: string): boolean {
  const probe = { mutated: false };
  const scan = (node: unknown): void => {
    if (probe.mutated || node === null || typeof node !== 'object') return;
    const n = node as PoisonNode;
    if (typeof n.type !== 'string') return;
    if (
      (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression') &&
      (isIdentifier(n.left ?? n.argument, name) ||
        mutatesMemberRootedAt(n.left ?? n.argument, name))
    ) {
      probe.mutated = true;
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
        continue;
      }
      const value = n[key];
      if (Array.isArray(value)) {
        for (const item of value) scan(item);
      } else if (value !== null && typeof value === 'object') scan(value);
    }
  };
  scan(body);
  return probe.mutated;
}

/** let/const/class/function names a BLOCK binds (block-scoped only). */
function blockScopedNames(block: PoisonNode): Set<string> {
  const out = new Set<string>();
  for (const stmt of (block.body as unknown[]) ?? []) {
    if (stmt === null || typeof stmt !== 'object') continue;
    const st = stmt as PoisonNode;
    if (st.type === 'VariableDeclaration' && st.kind !== 'var') {
      for (const decl of (st.declarations as unknown[]) ?? []) {
        const d = decl as PoisonNode;
        if (
          d.id !== null &&
          typeof d.id === 'object' &&
          (d.id as PoisonNode).type === 'Identifier'
        ) {
          out.add(String((d.id as PoisonNode).name));
        }
      }
    } else if (
      st.type === 'ClassDeclaration' ||
      st.type === 'FunctionDeclaration' ||
      st.type === 'FunctionExpression'
    ) {
      if (st.id !== null && typeof st.id === 'object') out.add(String((st.id as PoisonNode).name));
    }
  }
  return out;
}

function visitPoison(
  node: unknown,
  out: {
    poisoned: boolean;
    symbolArgCallees: Set<string>;
    mutatingSymbolParamFns: Set<string>;
  },
  shadowed: ReadonlySet<string> = new Set(),
  aliasesIn?: Set<string>,
): void {
  const aliases = aliasesIn ?? new Set<string>();
  if (out.poisoned || node === null || typeof node !== 'object') return;
  const n = node as PoisonNode;
  if (typeof n.type !== 'string') return;
  let innerShadowed = shadowed;
  let innerAliases = aliases;
  if (FUNCTION_LIKE.has(n.type)) {
    const names = scopeShadowedNames(n as PoisonNode);
    // A local binding named `Symbol` shadows the global identifier INSIDE
    // this scope — mutations there are local, not builtin mutations. Alias
    // knowledge snapshots at the boundary (outer aliases stay outer).
    innerShadowed = new Set([...shadowed, ...names]);
    innerAliases = new Set([...aliases]);
  } else if (n.type === 'BlockStatement') {
    // Block-scoped let/const/class/function shadow within the block only.
    const names = blockScopedNames(n as PoisonNode);
    if (names.size > 0) innerShadowed = new Set([...shadowed, ...names]);
  } else if (n.type === 'VariableDeclaration') {
    for (const decl of (n.declarations as unknown[]) ?? []) {
      const d = decl as PoisonNode;
      if (d === null || typeof d !== 'object') continue;
      const init = d.init;
      // Track aliases: const/let X = Symbol, or X = <known alias>
      // (transitive — const S = Symbol; const T = S; T.for = … poisons).
      if (
        init !== null &&
        typeof init === 'object' &&
        (init as PoisonNode).type === 'Identifier' &&
        d.id !== null &&
        typeof d.id === 'object' &&
        (d.id as PoisonNode).type === 'Identifier'
      ) {
        const initName = String((init as PoisonNode).name);
        const isAliasSource =
          (initName === 'Symbol' && !shadowed.has('Symbol')) ||
          (aliases.has(initName) && !shadowed.has(initName));
        if (isAliasSource) aliases.add(String((d.id as PoisonNode).name));
      }
    }
  }
  if (n.type === 'AssignmentExpression') {
    // let X; X = Symbol — alias born by assignment (unshadowed both sides);
    // X = <known alias> extends the alias chain transitively.
    if (
      n.right !== null &&
      typeof n.right === 'object' &&
      (n.right as PoisonNode).type === 'Identifier' &&
      n.left !== null &&
      typeof n.left === 'object' &&
      (n.left as PoisonNode).type === 'Identifier'
    ) {
      const rightName = String((n.right as PoisonNode).name);
      const leftName = String((n.left as PoisonNode).name);
      const isAliasSource =
        (rightName === 'Symbol' && !innerShadowed.has('Symbol')) ||
        (aliases.has(rightName) && !innerShadowed.has(rightName));
      if (isAliasSource && !innerShadowed.has(leftName)) aliases.add(leftName);
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
  // A global-Symbol argument flowing into a function whose parameter is named
  // `Symbol` AND whose body mutates that parameter poisons (the mutation
  // reaches the builtin). Pure identity-style functions stay loadable.
  if (n.type === 'CallExpression' && !shadowed.has('Symbol')) {
    const calleeName = nameOf(n.callee);
    if (calleeName !== undefined) {
      for (const arg of Array.isArray(n.arguments) ? (n.arguments as unknown[]) : []) {
        if (isIdentifier(arg, 'Symbol')) out.symbolArgCallees.add(calleeName);
      }
    }
  }
  if (FUNCTION_LIKE.has(n.type)) {
    const names = scopeShadowedNames(n as PoisonNode);
    if (names.has('Symbol')) {
      const body = (n as PoisonNode).body;
      if (body !== null && typeof body === 'object' && mutatesNameInside(body, 'Symbol')) {
        const fnName = nameOf((n as PoisonNode).id);
        if (fnName !== undefined) out.mutatingSymbolParamFns.add(fnName);
        else if (n.type === 'FunctionDeclaration') out.mutatingSymbolParamFns.add('');
      }
    }
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
  const out = {
    poisoned: false,
    symbolArgCallees: new Set<string>(),
    mutatingSymbolParamFns: new Set<string>(),
  };
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
  for (const callee of out.symbolArgCallees) {
    if (out.mutatingSymbolParamFns.has(callee)) return true;
  }
  return out.poisoned;
}
