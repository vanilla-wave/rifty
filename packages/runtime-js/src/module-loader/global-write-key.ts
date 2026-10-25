import { NotImplementedError } from '@riftydev/io';
import type { Edit } from './cjs-source-rewrite.ts';

// Property-key analysis shared by the CJS/ESM Function guards (ADR-0171) and
// the runtime check of global-write keys that do not fold (ADR-0444).

interface KeyNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

const reflectOwnKeys = Reflect.ownKeys;
const toPrimitiveSymbol = Symbol.toPrimitive;

/**
 * Key of a single-key write/define/delete on a tracked global object. `true` =
 * load-time ceiling: folds to `'Function'`, or no key expression to wrap
 * (missing/spread argument). Any other non-folding key is wrapped in the
 * runtime check `helperName(key)`.
 */
export function globalWriteKeyMayBeFunction(
  key: unknown,
  helperName: string,
  edits: Edit[],
): boolean {
  const folded = literalString(key);
  if (folded !== undefined) return folded === 'Function';
  if (!key || typeof key !== 'object') return true;
  const node = key as KeyNode;
  if (node.type === 'SpreadElement') return true;
  const sequence = node.type === 'SequenceExpression';
  edits.push(
    { start: node.start, end: node.start, text: `${helperName}(${sequence ? '(' : ''}` },
    { start: node.end, end: node.end, text: sequence ? '))' : ')' },
  );
  return false;
}

/**
 * Runtime half of ADR-0444. A primitive other than `'Function'` passes through
 * untouched; `'Function'` and object keys become a proxy V8 coerces exactly
 * where and as often as the original key, each time running the key's own
 * ToPropertyKey once and throwing the format's ceiling when it yields
 * `'Function'`.
 */
export function createGlobalWriteKeyCheck(
  feature: string,
  message: string,
): (key: unknown) => unknown {
  return (key) => {
    if (
      key !== 'Function' &&
      (key === null || (typeof key !== 'object' && typeof key !== 'function'))
    ) {
      return key;
    }
    return {
      [toPrimitiveSymbol](): PropertyKey {
        const coerced = reflectOwnKeys({ [key as PropertyKey]: 0 })[0] as PropertyKey;
        if (coerced === 'Function') throw new NotImplementedError(feature, message);
        return coerced;
      },
    };
  };
}

export function staticPropertyName(node: KeyNode): string | undefined {
  const n = unwrapChain(node) as KeyNode;
  const member = n as unknown as { computed?: boolean; property?: KeyNode };
  const property = member.property;
  if (!property) return undefined;
  if (!member.computed && property.type === 'Identifier') {
    return (property as unknown as { name?: string }).name;
  }
  return member.computed ? literalString(property) : undefined;
}

export function isComputedMember(node: KeyNode): boolean {
  return Boolean((unwrapChain(node) as unknown as { computed?: boolean }).computed);
}

export function staticPropertyKeyName(node: KeyNode): string | undefined {
  const property = node as unknown as { computed?: boolean; key?: KeyNode };
  const key = property.key;
  if (!key) return undefined;
  if (!property.computed && key.type === 'Identifier') {
    return (key as unknown as { name?: string }).name;
  }
  return literalString(key);
}

export function literalString(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = unwrapChain(node) as KeyNode;
  if (n.type === 'Literal') {
    const value = (n as unknown as { value?: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }
  if (n.type === 'BinaryExpression' && (n as unknown as { operator?: string }).operator === '+') {
    const left = literalString(n.left);
    const right = literalString(n.right);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  if (n.type === 'TemplateLiteral') {
    const expressions = (n as unknown as { expressions?: unknown[] }).expressions ?? [];
    if (expressions.length > 0) return undefined;
    const quasis = (n as unknown as { quasis?: KeyNode[] }).quasis ?? [];
    return quasis
      .map((quasi) => {
        const value = quasi.value as { cooked?: unknown } | undefined;
        return typeof value?.cooked === 'string' ? value.cooked : '';
      })
      .join('');
  }
  return undefined;
}

export function unwrapChain(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as KeyNode;
  if (n.type === 'ChainExpression') return unwrapChain(n.expression);
  if (n.type === 'SequenceExpression') {
    const expressions = (n as unknown as { expressions?: unknown[] }).expressions ?? [];
    return unwrapChain(expressions[expressions.length - 1]);
  }
  return node;
}
