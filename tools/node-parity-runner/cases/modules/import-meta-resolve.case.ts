import type { ParityCase } from '../../src/types.ts';

/**
 * `import.meta.resolve(spec)` (Node v20.6, sync) — real resolution via the
 * loader's resolver, replacing the inline `new URL(s, baseUrl).href` stub that
 * returned a WRONG `file://` URL for bare specifiers (it resolved `'lodashy'` to
 * `file://<cwd>/lodashy` instead of walking node_modules). `node:` builtins keep
 * their `node:` id. file:// URLs are normalised to suffix booleans so the case
 * is stable across Node's tmpdir cwd and rifty's `/work` cwd.
 */
const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'node_modules/lodashy/package.json': JSON.stringify({ name: 'lodashy', main: 'index.js' }),
      'node_modules/lodashy/index.js': 'export default 1;\n',
      'other.mjs': 'export const x = 1;\n',
    },
  },
  code: `
    console.log(import.meta.resolve('node:fs'));
    // Any node: specifier is returned VERBATIM — Node does not validate the
    // builtin exists at resolve time (only at import time).
    console.log(import.meta.resolve('node:zlibbbb'));
    const lodashUrl = import.meta.resolve('lodashy');
    console.log(lodashUrl.startsWith('file://'), lodashUrl.endsWith('/node_modules/lodashy/index.js'));
    const rel = import.meta.resolve('./other.mjs');
    console.log(rel.startsWith('file://'), rel.endsWith('/other.mjs'));
  `,
};

export default c;
