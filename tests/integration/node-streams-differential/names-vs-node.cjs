// The generated core after esbuild against Node's own modules (`require(id)` with
// --expose-internals): name and length of every function reachable from each module's exports —
// the export, its own properties, a function's statics and prototype members (values, getters,
// setters), one level into plain export objects. A selected module is compared on its exports.
// Prints the differing paths as JSON. usage: node --expose-internals names-vs-node.cjs
'use strict';
const { join } = require('node:path');
const { load } = require('./node-core.cjs');
const { modules } = require(
  join(__dirname, '../../../packages/io/src/streams/node/generated/sources.json'),
);

const shape = (f) =>
  `${typeof f === 'function' ? `${JSON.stringify(f.name)}/${f.length}` : typeof f}`;
function walk(path, ours, theirs, out, depth, seen) {
  if (seen.has(ours)) return;
  seen.add(ours);
  const isObj = (v) => (typeof v === 'object' && v !== null) || typeof v === 'function';
  if (!isObj(ours) || !isObj(theirs)) return;
  if (typeof ours === 'function' && shape(ours) !== shape(theirs))
    out.push(`${path}: ${shape(ours)} vs Node ${shape(theirs)}`);
  if (depth === 0) return;
  const targets = [[path, ours, theirs]];
  if (typeof ours === 'function' && ours.prototype && theirs.prototype)
    targets.push([`${path}.prototype`, ours.prototype, theirs.prototype]);
  for (const [p, a, b] of targets)
    for (const key of Reflect.ownKeys(a)) {
      if (key === 'prototype' || key === 'constructor' || key === 'caller' || key === 'arguments')
        continue;
      const da = Object.getOwnPropertyDescriptor(a, key);
      const db = Object.getOwnPropertyDescriptor(b, key);
      const k = `${p}.${String(key)}`;
      if (db === undefined) continue;
      for (const part of ['get', 'set'])
        if (typeof da[part] === 'function' && shape(da[part]) !== shape(db[part]))
          out.push(`${k} [${part}]: ${shape(da[part])} vs Node ${shape(db[part])}`);
      if ('value' in da) walk(k, da.value, db.value, out, depth - 1, seen);
    }
}
const out = [];
for (const [id, kind] of Object.entries(modules)) {
  const ours = load(id);
  const theirs = require(id);
  for (const key of Object.keys(kind === 'whole' ? theirs : ours))
    walk(`${id}:${key}`, ours[key], theirs[key], out, 2, new Set());
  if (kind === 'whole' && typeof theirs === 'function')
    walk(`${id}`, ours, theirs, out, 2, new Set());
}
process.stdout.write(JSON.stringify(out));
