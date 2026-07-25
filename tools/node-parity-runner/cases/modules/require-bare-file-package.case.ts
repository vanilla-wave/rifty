import type { ParityCase } from '../../src/types.ts';

// Node's LOAD_NODE_MODULES owns one ordered candidate pipeline per search dir:
// package exports, raw DIR/X as a file, then raw DIR/X as a directory. Keep the
// full request intact through that pipeline and skip nested node_modules paths.
const c: ParityCase = {
  setup: {
    files: {
      'node_modules/file:.js': 'module.exports = "pkg-file";\n',
      'node_modules/somepkg.js': 'module.exports = "loose-file";\n',
      'node_modules/primordial-file.js': 'module.exports = "primordial-file";\n',
      'node_modules/coexist.js': 'module.exports = "loose-unscoped";\n',
      'node_modules/coexist/package.json': '{"main":"index.js"}',
      'node_modules/coexist/index.js': 'module.exports = "directory-unscoped";\n',
      'node_modules/@scope/coexist.js': 'module.exports = "loose-scoped";\n',
      'node_modules/@scope/coexist/package.json': '{"main":"index.js"}',
      'node_modules/@scope/coexist/index.js': 'module.exports = "directory-scoped";\n',
      'node_modules/exported.js': 'module.exports = "loose-exported";\n',
      'node_modules/exported/package.json': '{"exports":"./entry.js"}',
      'node_modules/exported/entry.js': 'module.exports = "exports";\n',
      'node_modules/blocked.js': 'module.exports = "loose-blocked";\n',
      'node_modules/blocked/package.json': '{"exports":{".":"./entry.js"}}',
      'node_modules/blocked/entry.js': 'module.exports = "blocked-root";\n',
      'node_modules/blocked/secret.js': 'module.exports = "must-not-bypass-exports";\n',
      'sub/missing-entry.js': 'module.exports = require("missing-target");\n',
      'sub/node_modules/missing-target/package.json': '{"exports":"./absent.js"}',
      'node_modules/missing-target.js': 'module.exports = "must-not-fall-through";\n',
      'node_modules/exact-export/package.json': '{"exports":"./target"}',
      'node_modules/exact-export/target.js': 'module.exports = "must-not-add-extension";\n',
      'sub/near-entry.js': 'module.exports = require("near");\n',
      'sub/node_modules/near.js': 'module.exports = "near-loose";\n',
      'sub/node_modules/near/package.json': '{}',
      'node_modules/near.js': 'module.exports = "far-loose";\n',
      'node_modules/host/start.js': `
        try { module.exports = require('nested-only'); }
        catch (error) { module.exports = error.code; }
      `,
      'node_modules/node_modules/nested-only.js': 'module.exports = "must-skip-node-modules";\n',
      'node_modules/trail.js': 'module.exports = "must-not-trim-trailing-segment";\n',
      'node_modules/main-dot/package.json': '{"main":"."}',
      'node_modules/main-dot/index.js': 'module.exports = "main-dot-index";\n',
      'node_modules/secret/index.js': `
        globalThis.__secretEvaluations = (globalThis.__secretEvaluations || 0) + 1;
        module.exports = { evaluations: globalThis.__secretEvaluations };
      `,
    },
  },
  code: `
    const out = {};
    const cap = (label, fn) => {
      try { out[label] = fn(); }
      catch (error) { out[label] = error.code || error.name; }
    };
    const tail = (path, count = 1) => path.split('/').slice(-count).join('/');

    cap('file-colon', () => require('file:'));
    cap('somepkg', () => require('somepkg'));
    cap('somepkg-resolve', () => tail(require.resolve('somepkg')));
    cap('poisoned-endswith', () => {
      const saved = String.prototype.endsWith;
      try {
        String.prototype.endsWith = () => true;
        return require('primordial-file');
      } finally {
        String.prototype.endsWith = saved;
      }
    });
    cap('coexist', () => require('coexist'));
    cap('coexist-resolve', () => tail(require.resolve('coexist')));
    cap('scoped', () => require('@scope/coexist'));
    cap('scoped-resolve', () => tail(require.resolve('@scope/coexist'), 2));
    cap('exports-precedence', () => require('exported'));
    cap('exports-blocked', () => require('blocked/secret'));
    cap('exports-missing', () => require('./sub/missing-entry'));
    cap('exports-exact', () => require('exact-export'));
    cap('near', () => require('./sub/near-entry'));
    cap('skip-nested-node-modules', () => require('./node_modules/host/start'));
    cap('trailing-slash', () => require('trail/'));
    cap('trailing-dot', () => require('trail/.'));
    cap('main-dot', () => require('main-dot'));
    cap('dot-resolve', () => tail(require.resolve('file:///../secret'), 2));
    cap('dot-identity', () => {
      const dotted = require('file:///../secret');
      const plain = require('secret');
      return [dotted === plain, dotted.evaluations, globalThis.__secretEvaluations];
    });
    cap('missing', () => require('nosuchpkg'));
    console.log(JSON.stringify(out));
  `,
  expected:
    '{"file-colon":"pkg-file","somepkg":"loose-file","somepkg-resolve":"somepkg.js","poisoned-endswith":"primordial-file","coexist":"loose-unscoped","coexist-resolve":"coexist.js","scoped":"loose-scoped","scoped-resolve":"@scope/coexist.js","exports-precedence":"exports","exports-blocked":"ERR_PACKAGE_PATH_NOT_EXPORTED","exports-missing":"MODULE_NOT_FOUND","exports-exact":"MODULE_NOT_FOUND","near":"near-loose","skip-nested-node-modules":"MODULE_NOT_FOUND","trailing-slash":"MODULE_NOT_FOUND","trailing-dot":"MODULE_NOT_FOUND","main-dot":"main-dot-index","dot-resolve":"secret/index.js","dot-identity":[true,1,1],"missing":"MODULE_NOT_FOUND"}\n',
};

export default c;
