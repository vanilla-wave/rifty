interface AstNode {
  readonly type?: string;
  readonly [key: string]: unknown;
}

export interface SymbolKeyScope {
  readonly bindings: Set<string>;
  readonly symbolKeys: Set<string>;
}

function ast(node: unknown): AstNode | undefined {
  return node !== null && typeof node === 'object' ? (node as AstNode) : undefined;
}

export function literalString(node: unknown): string | undefined {
  const n = ast(node);
  if (!n) return undefined;
  if (n.type === 'ChainExpression') return literalString(n.expression);
  if (n.type === 'SequenceExpression') {
    const expressions = n.expressions as unknown[];
    return literalString(expressions[expressions.length - 1]);
  }
  if (n.type === 'Literal') return typeof n.value === 'string' ? n.value : undefined;
  if (n.type === 'BinaryExpression' && n.operator === '+') {
    const left = literalString(n.left);
    const right = literalString(n.right);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  if (n.type === 'TemplateLiteral') {
    const expressions = n.expressions as unknown[];
    if (expressions.length > 0) return undefined;
    return (n.quasis as AstNode[])
      .map((quasi) => {
        const value = quasi.value as { cooked?: unknown };
        return typeof value.cooked === 'string' ? value.cooked : '';
      })
      .join('');
  }
  return undefined;
}

export function isSymbolKey(node: unknown, scopes: readonly SymbolKeyScope[]): boolean {
  const n = ast(node);
  if (!n) return false;
  if (n.type === 'Identifier') {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const scope = scopes[i];
      if (scope?.bindings.has(n.name as string)) return scope.symbolKeys.has(n.name as string);
    }
    return false;
  }
  if (n.type !== 'CallExpression' || scopes.some((scope) => scope.bindings.has('Symbol')))
    return false;
  const callee = ast(n.callee);
  if (callee?.type === 'Identifier') return callee.name === 'Symbol';
  const object = ast(callee?.object);
  const property = ast(callee?.property);
  return (
    callee?.type === 'MemberExpression' &&
    object?.type === 'Identifier' &&
    object.name === 'Symbol' &&
    (callee.computed ? literalString(property) === 'for' : property?.name === 'for')
  );
}

export function markConstSymbolKey(
  declaration: unknown,
  kind: unknown,
  scopes: readonly SymbolKeyScope[],
): void {
  const decl = ast(declaration);
  const id = ast(decl?.id);
  if (kind !== 'const' || id?.type !== 'Identifier' || !isSymbolKey(decl?.init, scopes)) return;
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (scope?.bindings.has(id.name as string)) {
      scope.symbolKeys.add(id.name as string);
      return;
    }
  }
}
