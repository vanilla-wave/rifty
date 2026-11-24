// Declared DEP0169 rows (compat modules.md `node:url`): name → files, Node's and rifty's stdout.
// Each must still differ; a fix flips it.
'use strict';
module.exports = {
  // A non-writable, non-configurable `Error.stackTraceLimit` below 4 hides the frames from the
  // walk (Node's native walk ignores it): the `node_modules` caller warns.
  'stack-trace-limit-sealed': {
    files: {
      'node_modules/p/package.json': '{"name":"p","main":"index.js"}',
      'node_modules/p/index.js':
        "const url = require('url'); module.exports = () => url.parse('http://a.com/');",
      'main.js': `process.on('warning', (w) => console.log('warning', w.code));
Object.defineProperty(Error, 'stackTraceLimit', { value: 0, writable: false, configurable: false });
require('p')(); console.log('done');`,
    },
    node: 'done\n',
    rifty: 'done\nwarning DEP0169\n',
  },
};
