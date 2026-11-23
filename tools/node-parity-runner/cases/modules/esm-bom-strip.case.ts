import type { ParityCase } from '../../src/types.ts';

// Guard: Node's ESM loader strips a leading BOM from module source (so `#!`
// after it is still a hashbang) and from JSON modules; decoder fixes elsewhere must not leak into the loader.
const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'bom.mjs': '﻿export default 3;\n',
      'bom-shebang.mjs': '﻿#!/usr/bin/env node\nexport default 4;\n',
      'bom-data.json': '﻿{"b":2}',
    },
  },
  code: `
    import three from './bom.mjs';
    import four from './bom-shebang.mjs';
    import data from './bom-data.json' with { type: 'json' };
    console.log('esm', three, four);
    console.log('json', JSON.stringify(data));
  `,
};

export default c;
