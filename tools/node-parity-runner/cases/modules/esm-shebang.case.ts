import type { ParityCase } from '../../src/types.ts';

// ESM guard: the AST path already parses with `allowHashBang` (esm-ast.ts), so
// a shebang'd ESM entry strips clean. Pins that behavior against a future
// regression (e.g. dropping allowHashBang) — the CJS sibling fixes the gap;
// this proves ESM stays green.
const c: ParityCase = {
  kind: 'esm',
  code: "#!/usr/bin/env node\nconsole.log('shebang-esm-ran');\n",
};

export default c;
