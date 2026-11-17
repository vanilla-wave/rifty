import type { ParityCase } from '../../src/types.ts';

// Guard: Node's loaders strip a leading BOM where they decode for themselves —
// require() of .json (stripBOM), package.json, ESM (esm-bom-strip). A BOM'd
// CJS module still runs (V8 reads U+FEFF as whitespace). The same file read
// through fs keeps its BOM, so the decode fix must not leak into the loader.
const c: ParityCase = {
  setup: {
    files: {
      'bom.json': '﻿{"a":1}',
      'bom.cjs': '﻿module.exports = 1;\n',
      'node_modules/bompkg/package.json': '﻿{"name":"bompkg","main":"m.js"}',
      'node_modules/bompkg/m.js': 'module.exports = "pkg-main";\n',
    },
  },
  code: `
    const fs = require('node:fs');
    console.log('json', JSON.stringify(require('./bom.json')));
    console.log('cjs', require('./bom.cjs'));
    console.log('pkg', require('bompkg'));
    console.log('fs-keeps', fs.readFileSync('bom.json', 'utf8').charCodeAt(0).toString(16));
  `,
};

export default c;
