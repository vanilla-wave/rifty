import type { ParityCase } from '../../src/types.ts';

// Package loaders temporarily replace the .js extension hook and feed generated
// output through Module._compile. Invalid original source proves the hook ran.
const c: ParityCase = {
  setup: {
    files: {
      'config.js': 'export default { source: "original" };\n',
      'dep.js': 'module.exports = "dep";\n',
    },
  },
  code: `
    const target = require.resolve('./config.js');
    const defaultLoader = require.extensions['.js'];
    require.extensions['.js'] = (module, filename) => {
      if (filename === target) {
        module._compile(
          "module.exports = { source: 'bundled', dep: require('./dep.js') };",
          filename,
        );
      } else {
        defaultLoader(module, filename);
      }
    };
    delete require.cache[target];
    try {
      const loaded = require('./config.js');
      console.log(loaded.source + ':' + loaded.dep);
    } finally {
      require.extensions['.js'] = defaultLoader;
      delete require.cache[target];
    }
  `,
  expected: 'bundled:dep\n',
};

export default c;
