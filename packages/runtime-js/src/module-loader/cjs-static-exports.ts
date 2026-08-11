import { type Token, tokenizer as acornTokenizer, tokTypes } from 'acorn';
import { initSync, parse } from 'cjs-module-lexer';

const jsonStringifyPrimordial = JSON.stringify;
const reflectApplyPrimordial = Reflect.apply;
const stringCharCodeAtPrimordial = String.prototype.charCodeAt;
const stringIndexOfPrimordial = String.prototype.indexOf;
const stringSlicePrimordial = String.prototype.slice;

function stringCharCodeAt(value: string, index: number): number {
  return reflectApplyPrimordial(stringCharCodeAtPrimordial, value, [index]) as number;
}

function stringIndexOf(value: string, search: string): number {
  return reflectApplyPrimordial(stringIndexOfPrimordial, value, [search]) as number;
}

function stringSlice(value: string, start: number, end?: number): string {
  return reflectApplyPrimordial(stringSlicePrimordial, value, [start, end]) as string;
}

export interface CjsStaticExports {
  readonly names: readonly string[];
  readonly reexports: readonly string[];
}

interface AliasedDefinePropertyKeys {
  readonly source: string;
  readonly originals: ReadonlyMap<string, string>;
}

interface KeyEdit {
  readonly start: number;
  readonly end: number;
  readonly original: string;
}

type ValueToken = Token & { readonly value?: unknown };

initSync();

/** Node-compatible static CJS surface; pure after one synchronous WASM init. */
export function lexCjsStaticExports(source: string, id: string): CjsStaticExports {
  const result = parse(source, id);
  const aliased = aliasDefinePropertyKeys(source);
  if (aliased.source === source) {
    return { names: result.exports, reexports: result.reexports };
  }

  // The public lexer filters unsafe getters by export name, also erasing an
  // independent assignment or safe descriptor with that name. Per-call aliases
  // preserve its exact descriptor grammar while preventing that collision.
  const separated = parse(aliased.source, id);
  const names = new Set(result.exports);
  for (const name of separated.exports) names.add(aliased.originals.get(name) ?? name);
  return {
    names: [...names],
    reexports: result.reexports,
  };
}

function aliasDefinePropertyKeys(source: string): AliasedDefinePropertyKeys {
  if (stringIndexOf(source, 'defineProperty') === -1) {
    return { source, originals: new Map() };
  }

  const tokens = [...acornTokenizer(source, { ecmaVersion: 'latest' })] as ValueToken[];
  const edits: KeyEdit[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const key = definePropertyKeyToken(tokens, index, source);
    if (!key) continue;
    const original = typeof key.value === 'string' ? key.value : undefined;
    if (original === undefined || !isWellFormed(original)) continue;
    edits.push({ start: key.start, end: key.end, original });
  }
  if (edits.length === 0) return { source, originals: new Map() };

  const decodedTokens: string[] = [];
  for (const token of tokens) {
    if (typeof token.value === 'string') decodedTokens.push(token.value);
  }
  let prefix = '__rifty_odp_';
  while (prefixCollides(source, decodedTokens, prefix)) {
    prefix = `_${prefix}`;
  }

  let transformed = '';
  let cursor = 0;
  const originals = new Map<string, string>();
  let aliasIndex = 0;
  for (const edit of edits) {
    const alias = `${prefix}${aliasIndex++}`;
    originals.set(alias, edit.original);
    transformed += stringSlice(source, cursor, edit.start);
    transformed += jsonStringifyPrimordial(alias);
    cursor = edit.end;
  }
  transformed += stringSlice(source, cursor);
  return { source: transformed, originals };
}

function definePropertyKeyToken(
  tokens: readonly ValueToken[],
  start: number,
  source: string,
): ValueToken | undefined {
  if (
    !isExactName(tokens[start], source, 'Object') ||
    tokens[start + 1]?.type !== tokTypes.dot ||
    !isExactName(tokens[start + 2], source, 'defineProperty') ||
    tokens[start + 3]?.type !== tokTypes.parenL
  ) {
    return undefined;
  }

  let index = start + 4;
  if (isExactName(tokens[index], source, 'exports')) {
    index++;
  } else if (
    isExactName(tokens[index], source, 'module') &&
    tokens[index + 1]?.type === tokTypes.dot &&
    isExactName(tokens[index + 2], source, 'exports')
  ) {
    index += 3;
  } else {
    return undefined;
  }

  if (tokens[index]?.type !== tokTypes.comma || tokens[index + 1]?.type !== tokTypes.string) {
    return undefined;
  }
  return tokens[index + 1];
}

function isExactName(token: ValueToken | undefined, source: string, expected: string): boolean {
  return token?.type === tokTypes.name && stringSlice(source, token.start, token.end) === expected;
}

function isWellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = stringCharCodeAt(value, index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = stringCharCodeAt(value, ++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function prefixCollides(source: string, decodedTokens: readonly string[], prefix: string): boolean {
  if (stringIndexOf(source, prefix) !== -1) return true;
  for (const value of decodedTokens) {
    if (stringIndexOf(value, prefix) === 0) return true;
  }
  return false;
}
