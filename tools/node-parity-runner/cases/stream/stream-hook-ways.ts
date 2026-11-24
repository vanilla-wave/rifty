/**
 * Shared guest prelude for the `stream-hook-*` parity cases: every way Node
 * code defines a stream hook. `make(Base, hooks, way, opts)` builds one stream
 * whose hooks (`{ _write() {} }`, …) come from that way; `run(fn)` collects
 * one line per scenario and prints them after the streams settle.
 */
export const WAYS_PRELUDE = `
const stream = require('node:stream');
const util = require('node:util');
const { Readable, Writable, Duplex, Transform, PassThrough } = stream;
const WAYS = ['option', 'own', 'class', 'es5', 'chain', 'late'];
const e2s = (e) => (e ? (e.code ? e.code + ':' : '') + e.message : String(e));
function make(Base, hooks, way, opts = {}) {
  if (way === 'option') {
    const o = { ...opts };
    for (const [k, f] of Object.entries(hooks)) o[k.slice(1)] = f;
    return new Base(o);
  }
  if (way === 'own') {
    const s = new Base(opts);
    Object.assign(s, hooks);
    return s;
  }
  if (way === 'class') {
    class X extends Base {}
    Object.assign(X.prototype, hooks);
    return new X(opts);
  }
  if (way === 'es5') {
    function X(o) {
      if (!(this instanceof X)) return new X(o);
      Base.call(this, o);
    }
    util.inherits(X, Base);
    Object.assign(X.prototype, hooks);
    return new X(opts);
  }
  if (way === 'chain') {
    class A extends Base {}
    Object.assign(A.prototype, hooks);
    class B extends A {}
    return new B(opts);
  }
  if (way === 'late') {
    class X extends Base {}
    const s = new X(opts);
    Object.assign(X.prototype, hooks);
    return s;
  }
  throw new Error('unknown way ' + way);
}
const lines = [];
const report = [];
function scenario(name, body) {
  const l = [];
  let summary = () => l.join(',');
  try {
    const r = body(l);
    if (typeof r === 'function') summary = r;
  } catch (e) {
    l.push('threw ' + e2s(e));
  }
  report.push(() => lines.push(name + ' => ' + summary()));
}
function done(ms = 40) {
  setTimeout(() => {
    for (const f of report) f();
    for (const line of lines) console.log(line);
  }, ms);
}
`;
