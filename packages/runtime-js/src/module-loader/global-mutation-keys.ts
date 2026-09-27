import { NotImplementedError } from '@riftydev/io';
import type { Edit } from './cjs-source-rewrite.ts';

interface GuardNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

interface MutationRewrite {
  readonly edits: Edit[];
  readonly symbolKeyHelperName: string;
}

export type GlobalSymbolKeyValidator = (value: unknown) => symbol;

export function createGlobalSymbolKeyValidator(kind: 'cjs' | 'esm'): GlobalSymbolKeyValidator {
  return (value) => {
    if (typeof value === 'symbol') return value;
    throw new NotImplementedError(`module-loader.${kind}-global-function-assignment`);
  };
}

/** ADR-0444: validate actual keys; no assumption about a mutable Symbol factory. */
function guardMutationKey(node: unknown, ctx: MutationRewrite): boolean {
  const value = literalString(node);
  if (value !== undefined) return value === 'Function';
  if (!node || typeof node !== 'object') return true;
  const key = node as GuardNode;
  if (key.type === 'SpreadElement') return true;
  ctx.edits.push(
    { start: key.start, end: key.start, text: `${ctx.symbolKeyHelperName}((` },
    { start: key.end, end: key.end, text: '))' },
  );
  return false;
}

export function guardGlobalMutationMember(
  node: GuardNode,
  ctx: MutationRewrite,
  globalObject: boolean,
): boolean {
  if (!globalObject) return false;
  const name = staticPropertyName(node);
  return name === undefined && isComputedMember(node)
    ? guardMutationKey(node.property, ctx)
    : name === 'Function';
}

export function guardGlobalMutationCall(
  node: GuardNode,
  ctx: MutationRewrite,
  isShadowed: (name: string) => boolean,
  isGlobalObject: (node: unknown) => boolean,
): boolean {
  const callee = node.callee as GuardNode | undefined;
  const args = (node.arguments as unknown[] | undefined) ?? [];
  if (!callee || callee.type !== 'MemberExpression') return false;
  const object = callee.object as GuardNode | undefined;
  const objectName = object?.type === 'Identifier' ? object.name : undefined;
  const name = staticPropertyName(callee);
  const builtinObject = objectName === 'Object' && !isShadowed('Object');
  const builtinReflect = objectName === 'Reflect' && !isShadowed('Reflect');
  if (builtinObject && name === 'assign' && isGlobalObject(args[0])) {
    return args.slice(1).some((arg) => guardMutationMap(arg, ctx));
  }
  const objectDefine = builtinObject && (name === 'defineProperty' || name === 'defineProperties');
  const reflectMutation =
    builtinReflect && (name === 'defineProperty' || name === 'set' || name === 'deleteProperty');
  if ((objectDefine || reflectMutation) && isGlobalObject(args[0])) {
    return name === 'defineProperties'
      ? guardMutationMap(args[1], ctx)
      : guardMutationKey(args[1], ctx);
  }
  if (isGlobalObject(object) && (name === '__defineGetter__' || name === '__defineSetter__')) {
    return guardMutationKey(args[0], ctx);
  }
  return false;
}

function guardMutationMap(node: unknown, ctx: MutationRewrite): boolean {
  if (!node || typeof node !== 'object') return true;
  const object = node as GuardNode;
  if (object.type !== 'ObjectExpression') return true;
  const properties = (object.properties as GuardNode[] | undefined) ?? [];
  return properties.some((property) => {
    if (property.type === 'SpreadElement') return true;
    const name = staticPropertyKeyName(property);
    return name !== undefined
      ? name === 'Function'
      : property.computed
        ? guardMutationKey(property.key, ctx)
        : true;
  });
}

// Read/constructor guards keep their existing conservative classification.
export function propertyMayBeFunction(node: unknown): boolean {
  const value = literalString(node);
  return value === 'Function' || value === undefined;
}

export function staticPropertyName(node: GuardNode): string | undefined {
  const n = unwrapChain(node) as GuardNode;
  const member = n as unknown as { computed?: boolean; property?: GuardNode };
  const property = member.property;
  if (!property) return undefined;
  if (!member.computed && property.type === 'Identifier') {
    return (property as unknown as { name?: string }).name;
  }
  return member.computed ? literalString(property) : undefined;
}

export function isComputedMember(node: GuardNode): boolean {
  return Boolean((unwrapChain(node) as unknown as { computed?: boolean }).computed);
}

export function staticPropertyKeyName(node: GuardNode): string | undefined {
  const property = node as unknown as { computed?: boolean; key?: GuardNode };
  const key = property.key;
  if (!key) return undefined;
  if (!property.computed && key.type === 'Identifier') {
    return (key as unknown as { name?: string }).name;
  }
  return literalString(key);
}

export function literalString(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = unwrapChain(node) as GuardNode;
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
    const quasis = (n as unknown as { quasis?: GuardNode[] }).quasis ?? [];
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
  const n = node as GuardNode;
  if (n.type === 'ChainExpression') return unwrapChain(n.expression);
  if (n.type === 'SequenceExpression') {
    const expressions = (n as unknown as { expressions?: unknown[] }).expressions ?? [];
    return unwrapChain(expressions[expressions.length - 1]);
  }
  return node;
}
