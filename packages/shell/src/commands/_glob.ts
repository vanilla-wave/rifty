/**
 * Single-segment glob matching (ADR-0084 part 2). Scope: ONE path segment —
 * `*` (any run incl. empty, never `/`), `?` (one non-`/` char), `[…]` char
 * class with ranges and `[!…]`/`[^…]` negation. NO `**`, NO braces, NO
 * multi-segment globbing. The dispatcher handles dir-prefix splitting and
 * dotfile rules; this module only answers "does this segment match this name".
 */

import { escapeRegExp } from './_shared.ts';

/** Metacharacters that, unescaped, make a string a glob pattern. */
const GLOB_META = new Set(['*', '?', '[']);

/**
 * `true` iff `s` contains an unescaped `*`, `?`, or `[`. A backslash escapes the
 * next char (so `\*` is a literal star and not a glob trigger).
 */
export function hasGlobMeta(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\') {
      i++; // skip the escaped char
      continue;
    }
    if (GLOB_META.has(c)) return true;
  }
  return false;
}

/**
 * Translate ONE glob segment into an anchored RegExp source. `*` -> `[^/]*`,
 * `?` -> `[^/]`, `[…]` -> a char class (`!`/`^` negate). An unterminated `[`
 * is treated as a literal `[`. A backslash escapes the next char literally.
 */
function segmentToRegExpSource(pattern: string): string {
  let src = '';
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const c = pattern[i]!;
    if (c === '\\') {
      const next = pattern[i + 1];
      if (next === undefined) {
        src += '\\\\'; // trailing backslash → literal backslash
        i++;
      } else {
        src += escapeRegExp(next);
        i += 2;
      }
      continue;
    }
    if (c === '*') {
      src += '[^/]*';
      i++;
      continue;
    }
    if (c === '?') {
      src += '[^/]';
      i++;
      continue;
    }
    if (c === '[') {
      const close = findClassEnd(pattern, i);
      if (close === -1) {
        // Unterminated class — treat the `[` literally (bash behaviour).
        src += '\\[';
        i++;
        continue;
      }
      src += classToRegExp(pattern.slice(i + 1, close));
      i = close + 1;
      continue;
    }
    src += escapeRegExp(c);
    i++;
  }
  return `^${src}$`;
}

/**
 * Index of the `]` closing the class opened at `open` (`pattern[open] === '['`),
 * or -1 if none. A `]` as the FIRST class char is a literal member, not a close
 * (POSIX), as is a `]` right after a leading `!`/`^`.
 */
function findClassEnd(pattern: string, open: number): number {
  let i = open + 1;
  if (pattern[i] === '!' || pattern[i] === '^') i++;
  if (pattern[i] === ']') i++; // leading ] is a member
  for (; i < pattern.length; i++) {
    if (pattern[i] === ']') return i;
  }
  return -1;
}

/** Build a RegExp char-class source from the inside of a glob `[…]` (no brackets). */
function classToRegExp(body: string): string {
  let negate = false;
  let rest = body;
  if (rest.startsWith('!') || rest.startsWith('^')) {
    negate = true;
    rest = rest.slice(1);
  }
  let inner = '';
  let i = 0;
  while (i < rest.length) {
    const c = rest[i]!;
    // Range a-z: keep as-is when both ends present and not a trailing dash.
    if (rest[i + 1] === '-' && i + 2 < rest.length) {
      inner += `${escapeClassChar(c)}-${escapeClassChar(rest[i + 2]!)}`;
      i += 3;
      continue;
    }
    inner += escapeClassChar(c);
    i++;
  }
  // Exclude `/` from a negated class so `[^a]` never matches a path separator.
  return negate ? `[^/${inner}]` : `[${inner}]`;
}

/** Escape a char for use inside a RegExp `[…]` (only `]`, `\`, `^`, `-` matter). */
function escapeClassChar(c: string): string {
  return /[\]\\^-]/.test(c) ? `\\${c}` : c;
}

/**
 * Match ONE path segment `name` against a glob `pattern`. Anchored: the whole
 * name must match. `/` never matches `*`/`?`/`[…]` (single-segment scope).
 */
export function matchSegment(pattern: string, name: string): boolean {
  return new RegExp(segmentToRegExpSource(pattern)).test(name);
}
