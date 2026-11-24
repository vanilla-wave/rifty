// Prints the shape of node:zlib, node:child_process, node:worker_threads, one line per fact;
// run by `node -e` and by the isolate guest, outputs compared exactly (ceiling-modules.test.ts).
const events = require('node:events');
const stream = require('node:stream');
const zlib = require('node:zlib');
const cp = require('node:child_process');
const wt = require('node:worker_threads');
const known = new Map([
  [Object.prototype, 'Object.prototype'],
  [Function.prototype, 'Function.prototype'],
  [events.prototype, 'EventEmitter.prototype'],
  [events, 'EventEmitter'],
]);
for (const k of ['Stream', 'Readable', 'Duplex', 'Transform']) {
  known.set(stream[k], k);
  known.set(stream[k].prototype, `${k}.prototype`);
}
// Web globals the module re-exports: identity only (their shape is the guest's global ceiling).
const WEB = new Set(['MessagePort', 'MessageChannel', 'BroadcastChannel']);
const MODS = [
  ['zlib', zlib],
  ['child_process', cp],
  ['worker_threads', wt],
];
for (const [m, mod] of MODS)
  for (const k of Object.keys(mod)) {
    const v = mod[k];
    if (typeof v === 'function' && v.prototype && !WEB.has(k)) {
      known.set(v, `${m}.${k}`);
      known.set(v.prototype, `${m}.${k}.prototype`);
    }
  }
// An object not exported (Node's internal `Zlib`, `ZlibBase`, …): its constructor's name.
const label = (o) => {
  if (known.has(o)) return known.get(o);
  if (o === null) return 'null';
  if (typeof o === 'function') return `~${o.name}`;
  if (Object.hasOwn(o, 'constructor')) return `~${o.constructor.name}.prototype`;
  return `?${typeof o}`;
};
const chain = (o) => {
  const out = [];
  for (let p = Object.getPrototypeOf(o); p !== null; p = Object.getPrototypeOf(p))
    out.push(label(p));
  return out.join('>');
};
const isClass = (f) => /^class\b/.test(Function.prototype.toString.call(f));
const isAsync = (f) => /^async\b/.test(Function.prototype.toString.call(f));
const flags = (d) =>
  `${d.enumerable ? 'E' : '-'}${d.configurable ? 'C' : '-'}${'value' in d ? (d.writable ? 'W' : '-') : ''}`;
const fn = (f) => {
  let s = `fn name=${f.name} length=${f.length} prototype=${'prototype' in f} class=${isClass(f)} async=${isAsync(f)}`;
  for (const sym of Object.getOwnPropertySymbols(f)) {
    const d = Object.getOwnPropertyDescriptor(f, sym);
    s += ` [${String(sym)}] ${flags(d)} ${typeof d.value === 'function' ? `fn name=${d.value.name} length=${d.value.length} prototype=${'prototype' in d.value}` : typeof d.value}`;
  }
  if (f.prototype)
    s +=
      ` proto->${chain(f.prototype)} ctor->${chain(f)} protoOwn=${Reflect.ownKeys(f.prototype).map(String).join('|')}` +
      ` statics=${Object.getOwnPropertyNames(f)
        .filter((n) => !['length', 'name', 'prototype', 'arguments', 'caller'].includes(n))
        .join('|')}`;
  return s;
};
const data = (v) => {
  if (typeof v === 'function') return fn(v);
  if (typeof v === 'symbol')
    return `symbol ${String(v)} registered=${Symbol.keyFor(v) !== undefined}`;
  if (typeof v === 'object' && v !== null)
    return `object proto=${label(Object.getPrototypeOf(v))} frozen=${Object.isFrozen(v)} extensible=${Object.isExtensible(v)} ${JSON.stringify(v, (_, x) => (x === Number.POSITIVE_INFINITY ? 'Infinity' : x))}`;
  return `${typeof v} ${JSON.stringify(v)}`;
};
const out = [];
for (const [m, mod] of MODS) {
  out.push(
    `${m} proto=${label(Object.getPrototypeOf(mod))} symbols=${Object.getOwnPropertySymbols(mod).length}`,
  );
  out.push(`${m} names=${Object.getOwnPropertyNames(mod).join(',')}`);
  for (const k of Object.getOwnPropertyNames(mod)) {
    const d = Object.getOwnPropertyDescriptor(mod, k);
    if (d.get || d.set)
      out.push(`${m}.${k} accessor ${flags(d)} get=${typeof d.get} set=${typeof d.set}`);
    else out.push(`${m}.${k} value ${flags(d)} ${WEB.has(k) ? typeof d.value : data(d.value)}`);
  }
}
// The base chain of every zlib stream class, each base's own shape.
for (const p of new Set(
  ['Gzip', 'BrotliCompress', 'ZstdCompress'].flatMap((k) => {
    const bases = [];
    for (
      let c = Object.getPrototypeOf(zlib[k]);
      c !== stream.Transform;
      c = Object.getPrototypeOf(c)
    )
      bases.push(c);
    return bases;
  }),
))
  out.push(`base ${label(p)} ${fn(p)}`);
// Every own descriptor of the data tables.
for (const [n, o] of [
  ['zlib.constants', zlib.constants],
  ['zlib.codes', zlib.codes],
]) {
  const kinds = new Map();
  for (const k of Reflect.ownKeys(o)) {
    const f = flags(Object.getOwnPropertyDescriptor(o, k));
    kinds.set(f, (kinds.get(f) ?? 0) + 1);
  }
  out.push(`${n} descriptors ${[...kinds].map(([f, c]) => `${f}:${c}`).join(' ')}`);
}
// worker_threads.locks: its prototype's own members.
const lp = Object.getPrototypeOf(wt.locks);
out.push(
  `locks own=${Reflect.ownKeys(wt.locks).length} toString=${Object.prototype.toString.call(wt.locks)}`,
);
for (const k of Reflect.ownKeys(lp)) {
  const d = Object.getOwnPropertyDescriptor(lp, k);
  out.push(
    `locks.proto.${String(k)} ${flags(d)} ${typeof d.value === 'function' ? fn(d.value) : data(d.value)}`,
  );
}
for (const k of WEB) out.push(`worker_threads.${k}===${k} ${wt[k] === globalThis[k]}`);
out.push(
  `SHARE_ENV===Symbol.for ${wt.SHARE_ENV === Symbol.for('nodejs.worker_threads.SHARE_ENV')}`,
);
console.log(out.join('\n'));
