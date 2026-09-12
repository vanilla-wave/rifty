import type { ImportExpression, Program } from 'acorn';
import { parse as acornParse } from 'acorn';

interface NodeShape {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

interface Edit {
  readonly start: number;
  readonly end: number;
}

export interface DirectEvalImportEdit extends Edit {
  readonly text: string;
}

const importToken = /\bimport\b/;
const unsafeDynamicScopeToken = /\bFunction\b|\beval\b|\bwith\b/;
const jsonStringifyPrimordial = JSON.stringify;

/**
 * Rewrite a statically-known eval argument that contains real `import()` syntax.
 */
export function rewriteDirectEvalImportArgument(
  argument: unknown,
  helperName: string,
): string | null {
  const source = staticString(argument);
  if (source === undefined || !importToken.test(source) || unsafeDynamicScopeToken.test(source)) {
    return null;
  }

  let program: Program;
  try {
    program = acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowHashBang: false,
      locations: false,
    }) as Program;
  } catch {
    return null;
  }

  const edits: Edit[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const current = node as NodeShape;
    if (typeof current.type !== 'string') return;
    if (current.type === 'ImportExpression') {
      const expression = current as unknown as ImportExpression;
      edits.push({ start: expression.start, end: expression.start + 'import'.length });
      walk(expression.source);
      if (expression.options) walk(expression.options);
      return;
    }
    for (const key of Object.keys(current)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
        continue;
      }
      const value = current[key];
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
      } else if (typeof value === 'object') {
        walk(value);
      }
    }
  };
  walk(program);
  if (edits.length === 0) return null;

  let rewritten = '';
  let position = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    rewritten += source.slice(position, edit.start);
    rewritten += helperName;
    position = edit.end;
  }
  rewritten += source.slice(position);
  return jsonStringifyPrimordial(rewritten);
}

/** Indirect eval cannot see the lexical import helper and stays a loud ceiling. */
export function rewriteDirectEvalImportCallArgument(
  callNode: unknown,
  helperName: string,
  evalIsShadowed: boolean,
): DirectEvalImportEdit | null {
  if (!callNode || typeof callNode !== 'object') return null;
  const call = callNode as NodeShape;
  const callee = call.callee as NodeShape | undefined;
  if (
    call.type !== 'CallExpression' ||
    call.optional === true ||
    callee?.type !== 'Identifier' ||
    callee.name !== 'eval' ||
    evalIsShadowed
  ) {
    return null;
  }
  const argument = (call.arguments as unknown[] | undefined)?.[0] as NodeShape | undefined;
  const text = rewriteDirectEvalImportArgument(argument, helperName);
  return text === null || argument === undefined
    ? null
    : { start: argument.start, end: argument.end, text };
}

function staticString(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const current = unwrapChain(node) as NodeShape;
  if (current.type === 'Literal') {
    const value = (current as unknown as { value?: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }
  if (
    current.type === 'BinaryExpression' &&
    (current as unknown as { operator?: string }).operator === '+'
  ) {
    const left = staticString(current.left);
    const right = staticString(current.right);
    return left !== undefined && right !== undefined ? left + right : undefined;
  }
  if (current.type === 'TemplateLiteral') {
    const expressions = (current as unknown as { expressions?: unknown[] }).expressions ?? [];
    if (expressions.length > 0) return undefined;
    const quasis = (current as unknown as { quasis?: NodeShape[] }).quasis ?? [];
    return quasis
      .map((quasi) => {
        const value = quasi.value as { cooked?: unknown } | undefined;
        return typeof value?.cooked === 'string' ? value.cooked : '';
      })
      .join('');
  }
  return undefined;
}

function unwrapChain(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const current = node as NodeShape;
  if (current.type === 'ChainExpression') return unwrapChain(current.expression);
  return node;
}
