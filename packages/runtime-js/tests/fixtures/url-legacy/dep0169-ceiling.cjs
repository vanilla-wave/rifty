// DEP0169 ceiling rows whose difference is more than the missing warning line (ADR-0574
// §Corrections): name → files, Node's and rifty's { stdout, exitCode }. Each must still differ.
'use strict';
module.exports = {
  // Node throws the uncaught DEP0169 after the tick (exit 1); rifty never emits it.
  'throw-deprecation': {
    files: {
      'main.js': `process.throwDeprecation = true;
const url = require('url');
let r; try { r = url.parse('http://a.com/').hostname; } catch (e) { r = 'THROW ' + e.name + ' ' + e.code; }
console.log(r);`,
    },
    node: { stdout: 'a.com\n', exitCode: 1 },
    rifty: { stdout: 'a.com\n', exitCode: 0 },
  },
};
