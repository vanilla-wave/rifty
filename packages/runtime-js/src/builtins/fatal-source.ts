/** Source positions of guest frames for the fatal report (acorn over the guest file). */
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
