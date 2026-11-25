// Route B probe: Node v24.16.0's stream core (lib/stream.js, lib/stream/promises.js,
// lib/internal/streams/*.js) and lib/internal/fs/streams.js, compiled unedited as Node compiles them
// (exports, require, module, process, internalBinding, primordials). Modules rifty ships (events,
// buffer, string_decoder, timers, path, fs, async_hooks) come from rifty's loader; every other
// `internal/*` binding comes from this Node (--expose-internals). `used` records which ids resolve where.
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const RIFTY = new Set([
  'events',
  'buffer',
  'string_decoder',
  'timers',
  'path',
  'fs',
  'async_hooks',
]);
const VERBATIM = (id) =>
  id === 'stream' ||
  id === 'stream/promises' ||
  id.startsWith('internal/streams/') ||
  id === 'internal/fs/streams';

function loadVerbatim({ lib, riftyRequire, nodeRequire, process }) {
  const { internalBinding, primordials } = nodeRequire('internal/test/binding');
  const cache = new Map();
  const used = { verbatim: new Set(), rifty: new Set(), node: new Set() };
  const req = (id) => {
    const bare = id.replace(/^node:/, '');
    if (VERBATIM(bare)) {
      used.verbatim.add(bare);
      if (cache.has(bare)) return cache.get(bare).exports;
      const file = join(lib, `${bare}.js`);
      if (!existsSync(file)) throw new Error(`route B: no verbatim ${bare}`);
      const module = { exports: {} };
      cache.set(bare, module);
      const fn = vm.compileFunction(
        readFileSync(file, 'utf8'),
        ['exports', 'require', 'module', 'process', 'internalBinding', 'primordials'],
        { filename: `node:${bare} (v24.16.0, verbatim)` },
      );
      fn(module.exports, req, module, process, internalBinding, primordials);
      return module.exports;
    }
    if (RIFTY.has(bare)) {
      used.rifty.add(bare);
      return riftyRequire(bare);
    }
    used.node.add(bare);
    return nodeRequire(bare);
  };
  const stream = req('stream');
  const promises = req('stream/promises');
  const fsStreams = req('internal/fs/streams');
  return { stream, promises, fsStreams, used };
}
module.exports = { loadVerbatim };
