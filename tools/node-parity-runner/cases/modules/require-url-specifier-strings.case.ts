import type { ParityCase } from '../../src/types.ts';

// CJS specifiers are paths/package names, never URLs: Node rejects every
// URL-like require()/require.resolve() string with MODULE_NOT_FOUND even when
// the file exists, while import() of the same file: URL loads it. Pins the
// esm-gate on the resolver's shared scheme dispatch (review of PR #155).
const c: ParityCase = {
  setup: {
    files: {
      'real.js': 'module.exports = 42;\n',
    },
  },
  code: `
    const { pathToFileURL } = require('node:url');
    const fileUrl = pathToFileURL(require.resolve('./real.js')).href;
    const specifiers = [
      ['file', fileUrl],
      ['file-mixed', fileUrl.replace(/^file:/, 'FiLe:')],
      ['data', 'data:text/javascript,module.exports = 1'],
      ['data-mixed', 'DATA:text/javascript,module.exports = 1'],
      ['node-mixed', 'NODE:fs'],
      ['https', 'https://example.test/pkg.js'],
    ];
    const run = async () => {
      for (const [label, specifier] of specifiers) {
        try { require(specifier); console.log(label + ':LOADED'); }
        catch (error) { console.log(label + ':' + error.code); }
        try { require.resolve(specifier); console.log(label + ':resolve:FOUND'); }
        catch (error) { console.log(label + ':resolve:' + error.code); }
      }
      try {
        const m = await import(fileUrl);
        console.log('esm-control:' + m.default);
      } catch (error) {
        console.log('esm-control:' + error.code);
      }
    };
    module.exports = run();
  `,
  expected: [
    'file:MODULE_NOT_FOUND',
    'file:resolve:MODULE_NOT_FOUND',
    'file-mixed:MODULE_NOT_FOUND',
    'file-mixed:resolve:MODULE_NOT_FOUND',
    'data:MODULE_NOT_FOUND',
    'data:resolve:MODULE_NOT_FOUND',
    'data-mixed:MODULE_NOT_FOUND',
    'data-mixed:resolve:MODULE_NOT_FOUND',
    'node-mixed:MODULE_NOT_FOUND',
    'node-mixed:resolve:MODULE_NOT_FOUND',
    'https:MODULE_NOT_FOUND',
    'https:resolve:MODULE_NOT_FOUND',
    'esm-control:42',
    '',
  ].join('\n'),
};

export default c;
