import type { ParityCase } from '../../src/types.ts';

/**
 * #10 (perf audit 2026-06-05) — `normalizePath` already-normalized fast-path.
 *
 * Locks that the vfs fast-path (return an already-normalized absolute path
 * untouched, no alloc) stays byte-identical to Node's `path.posix.normalize`
 * across the edge set: fast-path hits (incl. dotted NAMES like `/...`,
 * `/a/..b` that are NOT `.`/`..` segments) AND slow-path collapses
 * (`/a/..`, `/a//b`, `/a/./b`). `expected` is pinned so a two-runtimes-agree-
 * on-the-wrong-string regression can't pass silently.
 */
const c: ParityCase = {
  expected: [
    '/a',
    '/a/b/c.txt',
    '/foo.bar/baz',
    '/...',
    '/..a',
    '/a/..b',
    '/a/b..c',
    '/',
    '/a',
    '/a/b/c',
    '/b',
    '/a/b',
  ].join('\n'),
  code: `
    const path = require('node:path');
    const n = path.posix.normalize;
    // Fast-path hits: already-normalized absolute paths returned unchanged.
    console.log(n('/a'));
    console.log(n('/a/b/c.txt'));
    console.log(n('/foo.bar/baz'));
    console.log(n('/...'));
    console.log(n('/..a'));
    console.log(n('/a/..b'));
    console.log(n('/a/b..c'));
    // Slow-path: . / .. / // collapse exactly as before.
    console.log(n('/a/..'));
    console.log(n('/a/.'));
    console.log(n('/a//b///c'));
    console.log(n('/a/../b'));
    console.log(n('/a/./b'));
  `,
};

export default c;
