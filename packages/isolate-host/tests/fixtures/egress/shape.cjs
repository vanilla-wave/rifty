// Prints the shape of node:http, node:https, node:net, one line per fact; run by `node -e`
// and by the isolate guest, outputs compared exactly (egress-modules.test.ts).
const events = require('node:events');
const stream = require('node:stream');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const known = new Map([
  [Object.prototype, 'Object.prototype'],
  [Function.prototype, 'Function.prototype'],
  [events.prototype, 'EventEmitter.prototype'],
  [events, 'EventEmitter'],
  [stream.Stream.prototype, 'Stream.prototype'],
  [stream.Stream, 'Stream'],
  [stream.Readable.prototype, 'Readable.prototype'],
  [stream.Readable, 'Readable'],
  [stream.Duplex.prototype, 'Duplex.prototype'],
  [stream.Duplex, 'Duplex'],
  [tls.Server.prototype, 'tls.Server.prototype'],
  [tls.Server, 'tls.Server'],
]);
// Web globals the module re-exports: identity only (their shape is the guest's global ceiling).
const WEB = new Set(['WebSocket', 'CloseEvent', 'MessageEvent']);
for (const [m, mod] of [
  ['http', http],
  ['https', https],
  ['net', net],
])
  for (const k of Object.keys(mod)) {
    const v = Object.getOwnPropertyDescriptor(mod, k).value;
    if (typeof v === 'function' && v.prototype) {
      if (!known.has(v)) known.set(v, `${m}.${k}`);
      if (!known.has(v.prototype)) known.set(v.prototype, `${m}.${k}.prototype`);
    }
  }
const label = (o) => known.get(o) ?? (o === null ? 'null' : `?${typeof o}`);
const fn = (f) =>
  `fn name=${f.name} length=${f.length} prototype=${'prototype' in f}${
    f.prototype
      ? ` proto->${label(Object.getPrototypeOf(f.prototype))} ctor->${label(Object.getPrototypeOf(f))}` +
        ` statics=${Object.getOwnPropertyNames(f)
          .filter((s) => !['length', 'name', 'prototype', 'arguments', 'caller'].includes(s))
          .join('|')}`
      : ''
  }`;
const data = (v) => {
  if (typeof v === 'function') return fn(v);
  if (typeof v === 'object' && v !== null) {
    if (v instanceof http.Agent) return `agent ${label(Object.getPrototypeOf(v))}`;
    return `${label(Object.getPrototypeOf(v))} ${JSON.stringify(v)}`;
  }
  return `${typeof v} ${String(v)}`;
};
const out = [];
for (const [m, mod] of [
  ['http', http],
  ['https', https],
  ['net', net],
]) {
  out.push(
    `${m} proto=${label(Object.getPrototypeOf(mod))} symbols=${Object.getOwnPropertySymbols(mod).length}`,
  );
  out.push(`${m} names=${Object.getOwnPropertyNames(mod).join(',')}`);
  for (const k of Object.getOwnPropertyNames(mod)) {
    const d = Object.getOwnPropertyDescriptor(mod, k);
    const flags = `${d.enumerable ? 'E' : '-'}${d.configurable ? 'C' : '-'}`;
    if (d.get || d.set)
      out.push(
        `${m}.${k} accessor ${flags} get=${typeof d.get} set=${typeof d.set} value: ${WEB.has(k) ? typeof mod[k] : data(mod[k])}`,
      );
    else out.push(`${m}.${k} value ${flags}${d.writable ? 'W' : '-'} ${data(d.value)}`);
  }
}
out.push(`net.Stream===net.Socket ${net.Stream === net.Socket}`);
out.push(`net.createConnection===net.connect ${net.createConnection === net.connect}`);
out.push(`http.WebSocket===WebSocket ${http.WebSocket === WebSocket}`);
out.push(`http.CloseEvent===CloseEvent ${http.CloseEvent === CloseEvent}`);
out.push(`http.MessageEvent===MessageEvent ${http.MessageEvent === MessageEvent}`);
out.push(`https.globalAgent instanceof https.Agent ${https.globalAgent instanceof https.Agent}`);
out.push(`http.globalAgent instanceof http.Agent ${http.globalAgent instanceof http.Agent}`);
for (const [n, C] of [
  ['http.Agent', http.Agent],
  ['https.Agent', https.Agent],
])
  for (const p of Object.getOwnPropertyNames(C.prototype))
    out.push(`${n}.prototype.${p} ${data(C.prototype[p])}`);
for (const [n, C] of [
  ['net.BlockList', net.BlockList],
  ['net.SocketAddress', net.SocketAddress],
])
  out.push(`${n} ${fn(C)} class=${/^class\b/.test(Function.prototype.toString.call(C))}`);
console.log(out.join('\n'));
