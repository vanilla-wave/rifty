import type { ParityCase } from '../../src/types.ts';

/**
 * A package's `"type": "module"` makes a sibling plain `.js` file classify as
 * ESM (Node `package.json#type` semantics). This is the exact classification
 * the resolver's `package.json` parse cache (#5, Q-2026-06-06-320) must NOT
 * corrupt: `pkg/lib.js` uses `export` syntax, which only parses if the resolver
 * read `pkg/package.json`'s `type:module` and detected ESM. A stale/missing
 * parse would classify it CJS and the `export` would be a SyntaxError.
 *
 * The entry (`main.mjs`) lives in a different scope (no package.json walked up
 * to `/work`), so this also exercises the per-package scope walk reaching the
 * nested `pkg/` manifest — the cache key is the absolute `pkg/package.json`
 * path, distinct from the entry's own scope.
 */
const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'pkg/package.json': JSON.stringify({ name: 'pkg', type: 'module' }),
      'pkg/lib.js': 'export const v = 42;\nexport const name = "from-esm-js";\n',
    },
  },
  code: `
    import { v, name } from './pkg/lib.js';
    console.log(v, name);
  `,
  expected: '42 from-esm-js',
};

export default c;
