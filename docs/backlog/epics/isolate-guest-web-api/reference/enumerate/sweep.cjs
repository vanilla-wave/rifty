// One-level sweep of every builtin module's exports and every global: typeof, a function's
// `prototype` typeof, identity with the same-named global, a throwing read. Runs unchanged in
// real Node and in the isolate guest. Input: names.json (Node's builtinModules + globals) next
// to the file (sandbox) or inline (runCode, see enumerate.mjs).
'use strict';
const input =
  typeof __SWEEP_INPUT__ !== 'undefined'
    ? __SWEEP_INPUT__
    : JSON.parse(
        require('node:fs').readFileSync(require('node:path').join(__dirname, 'names.json'), 'utf8'),
      );
const g = globalThis;
function kind(read) {
  let v;
  try {
    v = read();
  } catch (e) {
    return `throws ${e?.name}${e?.code ? ` ${e.code}` : ''}: ${String(e?.message)
      .split('\n')[0]
      .slice(0, 160)}`;
  }
  if (v === null) return 'null';
  let t = typeof v;
  if (t === 'function') {
    let p;
    try {
      p = v.prototype;
    } catch (_e) {
      p = 'throws';
    }
    t += `/${p === 'throws' ? 'throws' : p === null ? 'null' : typeof p}`;
  }
  return t;
}
const out = { modules: {}, globals: {} };
for (const id of input.modules) {
  let mod;
  try {
    mod = require(id);
  } catch (e) {
    out.modules[id] = {
      require: `throws ${e?.name}${e?.code ? ` ${e.code}` : ''}: ${String(e?.message)
        .split('\n')[0]
        .slice(0, 160)}`,
    };
    continue;
  }
  const rec = { require: kind(() => mod), keys: {} };
  if (mod !== null && (typeof mod === 'object' || typeof mod === 'function')) {
    for (const k of Object.getOwnPropertyNames(mod)) {
      let r = kind(() => mod[k]);
      if (input.globals.includes(k) && !r.startsWith('throws')) {
        try {
          r += mod[k] === g[k] ? ' =global' : ' !=global';
        } catch {
          r += ' global-throws';
        }
      }
      rec.keys[k] = r;
    }
  }
  out.modules[id] = rec;
}
for (const k of input.globals) out.globals[k] = k in g ? kind(() => g[k]) : 'absent';
console.log(JSON.stringify(out));
