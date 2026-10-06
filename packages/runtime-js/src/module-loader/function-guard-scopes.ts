/**
 * Shared function-guard scope machinery for the ESM and CJS Function write
 * guards (the two walkers' scope families were behavioral twins). A scope
 * tracks bindings plus the guard's alias sets; `symbolValueBindings` is the
 * guard-precision seam (guard-symbol-values.ts).
 */

export interface FunctionGuardScope {
  readonly bindings: Set<string>;
  readonly globalAliases: Set<string>;
  readonly maybeFunctionAliases: Set<string>;
  readonly maybeDerivedFunctionAliases: Set<string>;
  readonly maybeEvalAliases: Set<string>;
  // Identifiers provably holding a Symbol value (const `Symbol()`/`Symbol.for()`
  // init, same scope). A Symbol-valued computed key can never be 'Function'.
  readonly symbolValueBindings: Set<string>;
}

export type GuardAstNode = { readonly type: string; readonly [key: string]: unknown };

export function createFunctionGuardScope(): FunctionGuardScope {
  return {
    bindings: new Set(),
    globalAliases: new Set(),
    maybeFunctionAliases: new Set(),
    maybeDerivedFunctionAliases: new Set(),
    maybeEvalAliases: new Set(),
    symbolValueBindings: new Set(),
  };
}

export function addFunctionGuardBinding(scope: FunctionGuardScope, name: string | undefined): void {
  if (!name) return;
  scope.bindings.add(name);
  scope.globalAliases.delete(name);
  scope.maybeFunctionAliases.delete(name);
  scope.maybeDerivedFunctionAliases.delete(name);
  scope.maybeEvalAliases.delete(name);
  scope.symbolValueBindings.delete(name);
}

export function declareFunctionGuardPattern(scope: FunctionGuardScope, pattern: unknown): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardAstNode;
  switch (pat.type) {
    case 'Identifier':
      addFunctionGuardBinding(scope, (pat as unknown as { name?: string }).name);
      return;
    case 'ObjectPattern': {
      const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
      for (const prop of props) {
        const p = prop as GuardAstNode;
        if (p.type === 'RestElement') declareFunctionGuardPattern(scope, p.argument);
        else declareFunctionGuardPattern(scope, p.value);
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      for (const element of elements) declareFunctionGuardPattern(scope, element);
      return;
    }
    case 'RestElement':
      declareFunctionGuardPattern(scope, pat.argument);
      return;
    case 'AssignmentPattern':
      declareFunctionGuardPattern(scope, pat.left);
      return;
    default:
      return;
  }
}

export function declareFunctionGuardVariable(scope: FunctionGuardScope, node: unknown): void {
  const declarations = (node as unknown as { declarations?: unknown[] }).declarations ?? [];
  for (const decl of declarations) {
    declareFunctionGuardPattern(scope, (decl as GuardAstNode).id);
  }
}

export function declareFunctionGuardImport(scope: FunctionGuardScope, node: unknown): void {
  const specifiers = (node as unknown as { specifiers?: unknown[] }).specifiers ?? [];
  for (const specifier of specifiers) {
    addFunctionGuardBinding(scope, (specifier as { local?: { name?: string } }).local?.name);
  }
}

function collectFunctionScopeBindings(node: unknown, scope: FunctionGuardScope): void {
  if (!node || typeof node !== 'object') return;
  const n = node as GuardAstNode;
  if (typeof n.type !== 'string') return;
  switch (n.type) {
    case 'FunctionDeclaration':
      addFunctionGuardBinding(scope, (n.id as { name?: string } | undefined)?.name);
      return;
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassExpression':
    case 'ClassDeclaration':
      return;
    case 'VariableDeclaration':
      if ((n as unknown as { kind?: string }).kind === 'var')
        declareFunctionGuardVariable(scope, n);
      return;
    default:
      for (const key of Object.keys(n)) {
        if (
          key === 'type' ||
          key === 'start' ||
          key === 'end' ||
          key === 'loc' ||
          key === 'range'
        ) {
          continue;
        }
        const value = n[key];
        if (!value) continue;
        if (Array.isArray(value)) {
          for (const item of value) collectFunctionScopeBindings(item, scope);
        } else if (typeof value === 'object') {
          collectFunctionScopeBindings(value, scope);
        }
      }
  }
}

export function predeclareFunctionGuardScope(
  body: readonly unknown[],
  scope: FunctionGuardScope,
): void {
  for (const node of body) collectFunctionScopeBindings(node, scope);
}

/** ESM grammars pass `imports: true` (import declarations bind names). */
export function predeclareFunctionGuardLexialScope(
  body: readonly GuardAstNode[],
  scope: FunctionGuardScope,
  options?: { readonly imports?: boolean },
): void {
  for (const raw of body) {
    // `export const/let/class/function …` binds names exactly like the bare
    // declaration (the exporter node wraps it).
    const node =
      raw.type === 'ExportNamedDeclaration' &&
      raw.declaration !== null &&
      raw.declaration !== undefined
        ? (raw.declaration as GuardAstNode)
        : raw;
    if (options?.imports === true && node.type === 'ImportDeclaration') {
      declareFunctionGuardImport(scope, node);
    } else if (
      node.type === 'VariableDeclaration' &&
      (node as unknown as { kind?: string }).kind !== 'var'
    ) {
      declareFunctionGuardVariable(scope, node);
    } else if (node.type === 'ClassDeclaration' || node.type === 'FunctionDeclaration') {
      addFunctionGuardBinding(scope, (node.id as { name?: string } | undefined)?.name);
    }
  }
}

export function collectFunctionGuardPatternBindingNames(pattern: unknown, out: Set<string>): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as GuardAstNode;
  switch (pat.type) {
    case 'Identifier': {
      const name = (pat as unknown as { name?: string }).name;
      if (name) out.add(name);
      return;
    }
    case 'ObjectPattern': {
      const props = (pat as unknown as { properties?: unknown[] }).properties ?? [];
      for (const prop of props) {
        const p = prop as GuardAstNode;
        collectFunctionGuardPatternBindingNames(
          p.type === 'RestElement' ? p.argument : p.value,
          out,
        );
      }
      return;
    }
    case 'ArrayPattern': {
      const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
      for (const element of elements) collectFunctionGuardPatternBindingNames(element, out);
      return;
    }
    case 'RestElement':
      collectFunctionGuardPatternBindingNames(pat.argument, out);
      return;
    case 'AssignmentPattern':
      collectFunctionGuardPatternBindingNames(pat.left, out);
      return;
    default:
      return;
  }
}
