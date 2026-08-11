import type { ParityCase } from '../../src/types.ts';

/** `require()` accepts both explicit type-module and syntax-detected `.js` ESM. */
const c: ParityCase = {
  setup: {
    files: {
      'typed/package.json': '{"type":"module"}',
      'typed/value.js': `
        export const classification = 'type-module';
        export default 24;
      `,
      'ambiguous.js': `
        export const classification = 'syntax-detected';
        export default 42;
      `,
      'delegated/package.json': '{"type":"module"}',
      'delegated/value.js': 'export default 7;',
      'delegated-ambiguous.js': 'export default 8;',
    },
  },
  code: `
    const typed = require('./typed/value.js');
    const ambiguous = require('./ambiguous.js');
    const defaultJsLoader = require.extensions['.js'];
    const delegatedCalls = [];
    require.extensions['.js'] = function (module, filename) {
      delegatedCalls.push(filename.slice(filename.lastIndexOf('/') + 1));
      return defaultJsLoader.call(this, module, filename);
    };
    let delegatedTyped;
    let delegatedAmbiguous;
    try {
      delegatedTyped = require('./delegated/value.js');
      delegatedAmbiguous = require('./delegated-ambiguous.js');
    } finally {
      require.extensions['.js'] = defaultJsLoader;
    }
    console.log(JSON.stringify({
      typed: [typed.classification, typed.default, typed.__esModule],
      ambiguous: [ambiguous.classification, ambiguous.default, ambiguous.__esModule],
      delegated: [
        delegatedCalls,
        delegatedTyped.default,
        delegatedTyped.__esModule,
        delegatedAmbiguous.default,
        delegatedAmbiguous.__esModule,
      ],
    }));
  `,
  expected:
    '{"typed":["type-module",24,true],"ambiguous":["syntax-detected",42,true],"delegated":[["value.js","delegated-ambiguous.js"],7,true,8,true]}\n',
};

export default c;
