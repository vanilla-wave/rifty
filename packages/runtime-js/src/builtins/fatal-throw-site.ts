/**
 * Source proofs of V8's throw site for the fatal report header (JS sees only
 * the error's creation frames). A rule either proves the `throw` statement
 * that threw the error or gives up (no header) — never a guess.
 */
import { type Node as AcornNode, parse as acornParse } from 'acorn';

type Node = AcornNode & Record<string, unknown>;

export function parseProgram(source: string, file: string): AcornNode | null {
  const options = {
    ecmaVersion: 'latest',
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    locations: true,
  } as const;
  const esm = file.startsWith('file://') || file.endsWith('.mjs');
  try {
    return acornParse(source, { ...options, sourceType: esm ? 'module' : 'script' });
  } catch {
    return null;
  }
}

export function offsetOf(source: string, line: number, column: number): number | null {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = source.indexOf('\n', offset);
    if (newline === -1) return null;
    offset = newline + 1;
  }
  return offset + column;
}

function children(node: AcornNode): Node[] {
  const out: Node[] = [];
  const values = Object.values(node as unknown as Record<string, unknown>);
  for (let v = 0; v < values.length; v += 1) {
    const value = values[v];
    const list: unknown[] = Array.isArray(value) ? value : [value];
    for (let c = 0; c < list.length; c += 1) {
      const child = list[c];
      if (child !== null && typeof child === 'object' && typeof (child as Node).type === 'string')
        out.push(child as Node);
    }
  }
  return out;
}

/** Nodes enclosing `offset`, outermost first. */
export function enclosing(root: AcornNode, offset: number): Node[] {
  const chain: Node[] = [];
  let node: Node | undefined = root as Node;
  while (node !== undefined) {
    chain.push(node);
    node = children(node).find((child) => child.start <= offset && offset < child.end);
  }
  return chain;
}

const isFunction = (node: Node): boolean => /Function/u.test(node.type);

/** The innermost function at `chain`'s end; null at a module's top level. */
export function innermostFunction(chain: readonly Node[]): Node | null {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const node = chain[i] as Node;
    if (isFunction(node)) return node;
  }
  return null;
}

/** The catching `try` statements whose block encloses the end of `chain`, outermost first. */
export function catchingTries(chain: readonly Node[]): Node[] {
  const out: Node[] = [];
  for (let i = 0; i + 1 < chain.length; i += 1) {
    const node = chain[i] as Node;
    if (node.type === 'TryStatement' && node.handler !== null && chain[i + 1] === node.block)
      out.push(node);
  }
  return out;
}

/**
 * The one `throw <name>` the binding `name` reaches inside `scope`, when every
 * other use only reads or writes its members — the value cannot leave to be
 * thrown elsewhere. Null when it may (an argument, an alias, a closure).
 */
function soleThrowOf(scope: Node, name: string, declaration: Node): Node | null {
  let found: Node | null = null;
  let escapes = false;
  const visit = (node: Node, parent: Node | null, nested: boolean): void => {
    if (escapes) return;
    if (node.type === 'Identifier' && node.name === name && node !== declaration) {
      if (nested) escapes = true;
      else if (parent?.type === 'ThrowStatement') {
        if (found !== null) escapes = true;
        found = parent;
      } else if (parent?.type !== 'MemberExpression' || parent.object !== node) escapes = true;
      return;
    }
    const kids = children(node);
    for (let i = 0; i < kids.length; i += 1) {
      const kid = kids[i] as Node;
      // Non-computed member names and object keys are not references.
      if (node.type === 'MemberExpression' && kid === node.property && node.computed !== true)
        continue;
      if (
        (node.type === 'Property' || node.type === 'MethodDefinition') &&
        kid === node.key &&
        node.computed !== true &&
        node.shorthand !== true
      )
        continue;
      if (/Label|Break|Continue/u.test(node.type) && kid === node.label) continue;
      // A use another catch may intercept or a closure may run later is unproven.
      const guarded =
        isFunction(kid) ||
        kid.type === 'CatchClause' ||
        (node.type === 'TryStatement' && node.handler !== null && kid === node.block);
      visit(kid, node, nested || guarded);
    }
  };
  visit(scope, null, false);
  return escapes ? null : found;
}

/**
 * The last catch the error passed (`catches`, outermost of the outermost
 * catching frame) rethrows it: its parameter's sole `throw`, else unproven.
 */
export function rethrowSite(tryStatement: Node): Node | null {
  const handler = tryStatement.handler as Node;
  const param = handler.param as Node | null;
  if (param?.type !== 'Identifier') return null;
  return soleThrowOf(handler.body as Node, param.name as string, param);
}

/** `const e = new X(…)` at `chain`'s end, thrown by the binding's sole `throw e`. */
export function bindingThrowSite(chain: readonly Node[], offset: number): Node | null {
  let index = -1;
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const node = chain[i] as Node;
    if (node.type === 'NewExpression' && node.start === offset) index = i;
  }
  const declarator = chain[index - 1];
  const declaration = chain[index - 2];
  if (
    index < 2 ||
    declarator?.type !== 'VariableDeclarator' ||
    declarator.init !== chain[index] ||
    declaration?.kind !== 'const' ||
    (declarator.id as Node).type !== 'Identifier'
  )
    return null;
  let scope: Node | undefined;
  for (let i = index - 3; i >= 0 && scope === undefined; i -= 1) {
    const node = chain[i] as Node;
    if (node.type === 'Program' || node.type === 'BlockStatement' || isFunction(node)) scope = node;
  }
  const id = declarator.id as Node;
  return scope === undefined ? null : soleThrowOf(scope, id.name as string, id);
}
