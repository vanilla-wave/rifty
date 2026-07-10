import type { ParityCase } from '../../src/types.ts';

/**
 * Node's CJS wrapper receives a real Module object, not only `{ exports }`.
 * nodemon reads `module.parent.filename`; cache users also observe loaded state
 * and the bidirectional parent/children graph. Keep the whole metadata seam
 * pinned head-to-head so a package-specific workaround cannot satisfy it.
 */
const c: ParityCase = {
  setup: {
    files: {
      'shared.js': `
        const path = require('node:path');
        const base = (value) => typeof value === 'string' ? path.basename(value) : String(value);
        const parentDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(module), 'parent');
        module.exports = {
          during: {
            keys: Object.keys(module),
            parentOwn: Object.prototype.hasOwnProperty.call(module, 'parent'),
            parentDescriptor: {
              get: typeof parentDescriptor.get,
              set: typeof parentDescriptor.set,
              enumerable: parentDescriptor.enumerable,
              configurable: parentDescriptor.configurable,
            },
            exportsPlainObject: Object.getPrototypeOf(module.exports) === Object.prototype,
            filename: base(module.filename),
            idMatchesFilename: module.id === module.filename,
            pathMatchesDirname: typeof module.filename === 'string' && module.path === path.dirname(module.filename),
            parentFilename: base(module.parent && module.parent.filename),
            parentAlreadyHasChild: !!module.parent && Array.isArray(module.parent.children) && module.parent.children.includes(module),
            loaded: module.loaded,
            children: Array.isArray(module.children) ? module.children.length : null,
            pathsIsArray: Array.isArray(module.paths),
            firstPathMatches: Array.isArray(module.paths) && module.paths[0] === path.join(module.path, 'node_modules'),
          },
          after: () => ({
            loaded: module.loaded,
            parentFilename: base(module.parent && module.parent.filename),
          }),
        };
      `,
      'first.js': `
        const shared = require('./shared.js');
        const again = require('./shared.js');
        module.exports = {
          shared,
          duringLoaded: module.loaded,
          after: () => ({
            loaded: module.loaded,
            childCount: Array.isArray(module.children) ? module.children.length : null,
            cachedChildLinked: Array.isArray(module.children) && module.children[0].exports === shared,
            sameCachedExports: shared === again,
          }),
        };
      `,
      'second.js': `
        const shared = require('./shared.js');
        module.exports = {
          after: () => ({
            loaded: module.loaded,
            childCount: Array.isArray(module.children) ? module.children.length : null,
            cachedChildLinked: Array.isArray(module.children) && module.children[0].exports === shared,
          }),
        };
      `,
      'node_modules/metadata-probe/package.json': '{"main":"index.js"}',
      'node_modules/metadata-probe/index.js': `
        const path = require('node:path');
        module.exports = {
          firstPathMatches: module.paths[0] === path.join(module.path, 'node_modules'),
          pathsAreUnique: new Set(module.paths).size === module.paths.length,
          skipsDoubledNodeModules: !module.paths.some((entry) => entry.includes('/node_modules/node_modules')),
        };
      `,
    },
  },
  code: `
    const first = require('./first.js');
    const second = require('./second.js');
    const packageMetadata = require('metadata-probe');
    console.log(JSON.stringify({
      sharedDuring: first.shared.during,
      firstDuringLoaded: first.duringLoaded,
      sharedAfter: first.shared.after(),
      firstAfter: first.after(),
      secondAfter: second.after(),
      packageMetadata,
    }));
  `,
};

export default c;
