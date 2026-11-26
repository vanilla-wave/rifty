// The differential's Node column: the generated core (io streams/node/generated/node-streams.js)
// over Node's own bindings — Node's primordials and internalBinding (`internal/test/binding`),
// Node's modules and internals for every bound id, the real `process`. A program's
// `require('stream')`, `stream/promises` and `fs` (its stream classes) get that core, as the
// rifty column's do (rifty-core.mts). usage: node --expose-internals --require node-core.cjs <entry>
'use strict';
const Module = require('node:module');
const { join } = require('node:path');

const emitWarning = process.emitWarning;
process.emitWarning = () => {}; // internal/test/binding's own "for internal testing only" warning
const { primordials, internalBinding } = require('internal/test/binding');
process.emitWarning = emitWarning;

const { default: createNodeStreamCore } = require(
  join(__dirname, '../../../packages/io/src/streams/node/generated/node-streams.js'),
);
const nodeRequire = Module.createRequire(__filename);
const load = createNodeStreamCore(primordials, internalBinding, nodeRequire, process);
const { fsWithCoreStreams } = require('./fs-facade.cjs');
const over = {
  __proto__: null,
  stream: load('stream'),
  'stream/promises': load('stream/promises'),
  fs: fsWithCoreStreams(nodeRequire('fs'), load('internal/fs/streams')),
};
// The hook reads only intrinsics captured here: a program that replaces some (p1) reaches the
// core's lazy requires through it, and Node's own internal require reads none.
const { ReflectApply, StringPrototypeStartsWith, StringPrototypeSlice } = primordials;
const original = Module._load;
Module._load = function (request, parent, isMain) {
  const id = StringPrototypeStartsWith(request, 'node:')
    ? StringPrototypeSlice(request, 5)
    : request;
  if (
    (id === 'stream' || id === 'stream/promises' || id === 'fs') &&
    parent?.filename !== __filename
  )
    return over[id];
  return ReflectApply(original, this, [request, parent, isMain]);
};
module.exports = { load };
