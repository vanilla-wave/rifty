import type { ParityCase } from '../../src/types.ts';

// Node's LOAD_NODE_MODULES runs LOAD_AS_FILE(DIR/X) before LOAD_AS_DIRECTORY:
// a loose `node_modules/<name>.js` file (no package directory) loads, including
// a name that merely LOOKS like a URL scheme (`require('file:')` →
// node_modules/file:.js). Pins the walk step the resolver was missing.
const c: ParityCase = {
  setup: {
    files: {
      'node_modules/file:.js': 'module.exports = "pkg-file";\n',
      'node_modules/somepkg.js': 'module.exports = "loose-file";\n',
    },
  },
  code: `
    const out = {};
    const cap = (label, fn) => {
      try { out[label] = fn(); } catch (error) { out[label] = error.code; }
    };
    cap('file-colon', () => require('file:'));
    cap('somepkg', () => require('somepkg'));
    cap('somepkg-resolve', () => require.resolve('somepkg').split('/').pop());
    cap('missing', () => require('nosuchpkg'));
    console.log(JSON.stringify(out));
  `,
  expected:
    '{"file-colon":"pkg-file","somepkg":"loose-file","somepkg-resolve":"somepkg.js","missing":"MODULE_NOT_FOUND"}\n',
};

export default c;
