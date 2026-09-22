/**
 * A computed key bound to Symbol() / Symbol.for() cannot be the string 'Function'.
 * String and unknown keys stay on the existing ceiling.
 */
const SYMBOL_KEYS = new WeakMap<object, Set<string>>();
const LOOP_KEYS = new WeakMap<object, Set<string>>();
const FUNCTION_STRING_KEYS = new WeakMap<object, Set<string>>();

interface AstNode {
  readonly type?: string;
  readonly name?: string;
  readonly value?: unknown;
  readonly computed?: boolean;
  readonly callee?: AstNode;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly arguments?: readonly unknown[];
}

interface BindingScope {
  readonly bindings: Set<string>;
}

function asNode(value: unknown): AstNode | null {
  if (!value || typeof value !== 'object') return null;
  return value as AstNode;
}

function isGlobalSymbolCall(node: AstNode, scopes: readonly BindingScope[]): boolean {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (!callee) return false;
  if (callee.type === 'Identifier' && callee.name === 'Symbol') {
    return !isShadowed(scopes, 'Symbol');
  }
  if (callee.type !== 'MemberExpression' || callee.computed) return false;
  const object = callee.object;
  const property = callee.property;
  return (
    object?.type === 'Identifier' &&
    object.name === 'Symbol' &&
    property?.type === 'Identifier' &&
    property.name === 'for' &&
    !isShadowed(scopes, 'Symbol')
  );
}

function isShadowed(scopes: readonly BindingScope[], name: string): boolean {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (scopes[i]?.bindings.has(name)) return true;
  }
  return false;
}

export function noteConstSymbolBinding(
  scope: BindingScope,
  kind: string | undefined,
  id: unknown,
  init: unknown,
  scopes: readonly BindingScope[],
): void {
  if (kind !== 'const') return;
  const nameNode = asNode(id);
  const name = nameNode?.type === 'Identifier' ? nameNode.name : undefined;
  const initNode = asNode(init);
  if (!name || !initNode || !isGlobalSymbolCall(initNode, scopes)) return;
  const set = SYMBOL_KEYS.get(scope) ?? new Set<string>();
  set.add(name);
  SYMBOL_KEYS.set(scope, set);
}

function noteConstFunctionString(
  scope: BindingScope,
  kind: string | undefined,
  id: unknown,
  init: unknown,
): void {
  if (kind !== 'const') return;
  const name = asNode(id)?.type === 'Identifier' ? asNode(id)?.name : undefined;
  const initNode = asNode(init);
  if (!name || initNode?.type !== 'Literal' || initNode.value !== 'Function') return;
  const set = FUNCTION_STRING_KEYS.get(scope) ?? new Set<string>();
  set.add(name);
  FUNCTION_STRING_KEYS.set(scope, set);
}

export function noteSymbolConst(
  scope: BindingScope,
  statement: unknown,
  decl: unknown,
  scopes: readonly BindingScope[],
): void {
  const kind = (asNode(statement) as { kind?: string } | null)?.kind;
  const body = asNode(decl) as ({ id?: unknown; init?: unknown } & AstNode) | null;
  noteConstSymbolBinding(scope, kind, body?.id, body?.init, scopes);
  noteConstFunctionString(scope, kind, body?.id, body?.init);
}

export function noteLoopKey(scope: BindingScope, decl: unknown): void {
  const node = asNode(decl) as
    | (AstNode & { kind?: string; declarations?: { id?: unknown }[] })
    | null;
  if (!node || node.kind === 'var') return;
  const id = asNode(node.declarations?.[0]?.id);
  const name = id?.type === 'Identifier' ? id.name : undefined;
  if (!name) return;
  const set = LOOP_KEYS.get(scope) ?? new Set<string>();
  set.add(name);
  LOOP_KEYS.set(scope, set);
}

function isLoopKey(node: unknown, scopes: readonly BindingScope[]): boolean {
  const ast = asNode(node);
  if (ast?.type !== 'Identifier' || typeof ast.name !== 'string') return false;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!scope) continue;
    if (LOOP_KEYS.get(scope)?.has(ast.name)) return true;
    if (scope.bindings.has(ast.name)) return false;
  }
  return false;
}

export function keyFn(
  propertyName: string | undefined,
  computed: boolean,
  property: unknown,
  scopes: readonly BindingScope[],
): boolean {
  return computedKeyIsFunction(propertyName, computed, property, scopes);
}

export function isSymbol(node: unknown, scopes: readonly BindingScope[]): boolean {
  return expressionIsProvableSymbol(node, scopes);
}

function isConstFunctionString(node: unknown, scopes: readonly BindingScope[]): boolean {
  const ast = asNode(node);
  if (ast?.type !== 'Identifier' || typeof ast.name !== 'string') return false;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (!scope) continue;
    if (FUNCTION_STRING_KEYS.get(scope)?.has(ast.name)) return true;
    if (scope.bindings.has(ast.name)) return false;
  }
  return false;
}

export function mayBeFunctionKey(
  node: unknown,
  scopes: readonly BindingScope[],
  literal: string | undefined,
): boolean {
  if (expressionIsProvableSymbol(node, scopes) || isLoopKey(node, scopes)) return false;
  if (literal === 'Function' || isConstFunctionString(node, scopes)) return true;
  // A bare identifier is a runtime name, not the string 'Function'. Expressions stay loud.
  if (asNode(node)?.type === 'Identifier') return false;
  return literal === undefined;
}

function computedKeyIsFunction(
  propertyName: string | undefined,
  computed: boolean,
  property: unknown,
  scopes: readonly BindingScope[],
): boolean {
  if (propertyName === 'Function') return true;
  if (!computed) return false;
  return mayBeFunctionKey(property, scopes, undefined);
}

export function expressionIsProvableSymbol(
  node: unknown,
  scopes: readonly BindingScope[],
): boolean {
  const ast = asNode(node);
  if (!ast) return false;
  if (ast.type === 'Identifier' && typeof ast.name === 'string') {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const scope = scopes[i];
      if (!scope) continue;
      if (SYMBOL_KEYS.get(scope)?.has(ast.name)) return true;
      if (scope.bindings.has(ast.name)) return false;
    }
    return false;
  }
  return isGlobalSymbolCall(ast, scopes);
}
