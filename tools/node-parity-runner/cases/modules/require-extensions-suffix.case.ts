import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'multi.foo.bar': 'this source must not execute',
      'fallback.foo.bar': 'this source must not execute',
      'data.json': 'this is deliberately invalid JSON',
      'config.ts': 'const uncompiled: never = "must not execute";\n',
      'message.txt': 'raw text must not bypass the current js hook',
      '.hidden': 'this source must not execute',
      'dir.with.dot/plain': 'this source must not execute',
    },
  },
  code: `
    const results = [];
    const hook = (label) => function (module, filename) {
      module.exports = {
        label,
        receiver: this === require.extensions,
        filename: filename.slice(filename.lastIndexOf('/') + 1),
      };
    };
    const defaultJs = require.extensions['.js'];
    require.extensions['.bar'] = hook('short');
    require.extensions['.foo.bar'] = hook('long');
    require.extensions['.json'] = hook('json');
    try {
      results.push(require('./multi.foo.bar'));
      require.extensions['.foo.bar'] = 0;
      results.push(require('./fallback.foo.bar'));
      results.push(require('./data.json'));
      delete require.extensions['.bar'];
      delete require.extensions['.foo.bar'];
      delete require.extensions['.json'];
      require.extensions['.js'] = hook('js-fallback');
      const compiled = require('./config.ts');
      results.push(compiled);
      results.push(require('./message.txt'));
      require.extensions['.hidden'] = hook('wrong-hidden');
      require.extensions['.with.dot/plain'] = hook('wrong-parent');
      results.push(require('./.hidden'));
      results.push(require('./dir.with.dot/plain'));
      require.extensions['.js'] = { not: 'callable' };
      results.push(require('./config.ts') === compiled);
      console.log(JSON.stringify(results));
    } finally {
      delete require.extensions['.bar'];
      delete require.extensions['.foo.bar'];
      delete require.extensions['.json'];
      delete require.extensions['.hidden'];
      delete require.extensions['.with.dot/plain'];
      require.extensions['.js'] = defaultJs;
    }
  `,
  expected:
    '[{"label":"long","receiver":true,"filename":"multi.foo.bar"},{"label":"short","receiver":true,"filename":"fallback.foo.bar"},{"label":"json","receiver":true,"filename":"data.json"},{"label":"js-fallback","receiver":true,"filename":"config.ts"},{"label":"js-fallback","receiver":true,"filename":"message.txt"},{"label":"js-fallback","receiver":true,"filename":".hidden"},{"label":"js-fallback","receiver":true,"filename":"plain"},true]\n',
};

export default c;
