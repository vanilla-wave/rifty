import type { ParityCase } from '../../src/types.ts';

// Vite's CJS config loader temporarily replaces the .js extension hook and
// feeds Rolldown's bundled output through Module._compile. The original source
// is intentionally invalid CJS so success proves the hook, not the file, ran.
const c: ParityCase = {
  setup: {
    files: {
      'vite.config.js': 'export default { source: "original" };\n',
      'dep.js': 'module.exports = "dep";\n',
    },
  },
  code: `
    const target = require.resolve('./vite.config.js');
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
      const loaded = require('./vite.config.js');
      console.log(loaded.source + ':' + loaded.dep);
    } finally {
      require.extensions['.js'] = defaultLoader;
      delete require.cache[target];
    }
  `,
  expected: 'bundled:dep\n',
};

export default c;
