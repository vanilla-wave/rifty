// Hostile run 1: hooks every intrinsic it can reach, then drives every fs path; reports any value
// that is not of its own realm (a foreign object), and plants on the prototype of whatever it finds.
const fs = require('node:fs');
const RA = Reflect.apply;
const GPO = Object.getPrototypeOf;
const DP = Object.defineProperty;
const GOPD = Object.getOwnPropertyDescriptor;
const found = [];
const seen = new Set();
// Foreign = its prototype chain ends at another realm's Object.prototype (a null-prototype object is not).
const OP = Object.prototype;
const isForeign = (x) => {
  if (x === null || (typeof x !== 'object' && typeof x !== 'function')) return false;
  let p = x;
  let last = null;
  for (let i = 0; i < 64 && p !== null; i++) {
    last = p;
    p = GPO(p);
  }
  return last !== null && last !== x && last !== OP
    ? true
    : last === x && x !== OP && GPO(x) === null
      ? false
      : last !== OP && last !== x;
};
function note(where, x) {
  try {
    if (isForeign(x) && !seen.has(where)) {
      seen.add(where);
      found[found.length] = where;
      try {
        const p = GPO(x);
        if (p) DP(p, '__pwned', { value: 1, configurable: true });
      } catch {}
    }
  } catch {}
  return x;
}
const targets = [
  [Object, 'keys'],
  [Object, 'getOwnPropertyNames'],
  [Object, 'entries'],
  [Object, 'assign'],
  [Object, 'getPrototypeOf'],
  [Object, 'create'],
  [Array, 'isArray'],
  [Array, 'from'],
  [ArrayBuffer, 'isView'],
  [JSON, 'parse'],
  [JSON, 'stringify'],
  [Reflect, 'apply'],
  [Reflect, 'ownKeys'],
  [Reflect, 'construct'],
  [Array.prototype, 'map'],
  [Array.prototype, 'forEach'],
  [Array.prototype, 'push'],
  [Array.prototype, 'slice'],
  [Array.prototype, 'includes'],
  [Array.prototype, 'join'],
  [Array.prototype, 'sort'],
  [Array.prototype, 'concat'],
  [GPO(Uint8Array.prototype), 'set'],
  [GPO(Uint8Array.prototype), 'subarray'],
  [GPO(Uint8Array.prototype), 'slice'],
  [String.prototype, 'split'],
  [String.prototype, 'slice'],
  [Map.prototype, 'get'],
  [Map.prototype, 'set'],
  [Set.prototype, 'has'],
  [Promise.prototype, 'then'],
];
for (const [o, k] of targets) {
  const orig = o[k];
  const hook = function (...a) {
    note(`${k}:this`, this);
    for (let i = 0; i < a.length; i++) note(`${k}:arg${i}`, a[i]);
    return note(
      `${k}:ret`,
      new.target ? Reflect.construct(orig, a, new.target) : RA(orig, this, a),
    );
  };
  try {
    o[k] = hook;
  } catch {}
}
// accessors on Object.prototype / Array.prototype for the keys a boundary may read or write
for (const key of [
  'code',
  'path',
  'message',
  'r',
  'b',
  'e',
  'p',
  'm',
  '__b',
  'recursive',
  'force',
  'isFile',
  'isDirectory',
  'size',
  'mtime',
  'metadata',
  'name',
  'then',
  'constructor',
]) {
  let slot;
  try {
    DP(Object.prototype, key, {
      configurable: true,
      get() {
        note(`get ${key}:this`, this);
        return slot;
      },
      set(v) {
        note(`set ${key}:this`, this);
        note(`set ${key}:v`, v);
        slot = v;
      },
    });
  } catch {}
}
// species and constructor lookups
for (const C of [Uint8Array, ArrayBuffer, Array, Promise]) {
  try {
    DP(C, Symbol.species, {
      configurable: true,
      get() {
        note('species:this', this);
        return C;
      },
    });
  } catch {}
}
const _out = [];
const tryOp = (name, f) => {
  try {
    note(`${name}:ret`, f());
  } catch (e) {
    note(`${name}:err`, e);
    note(`${name}:errproto`, e && GPO(e));
  }
};
// getters, thenables and Proxies as arguments
const opts = {
  get recursive() {
    const g = GOPD(opts, 'recursive').get;
    note('getter caller', g.caller);
    return true;
  },
  then() {
    note('then:this', this);
  },
};
tryOp('mkdir', () => fs.mkdirSync('/workspace/h/a/b', opts));
tryOp('write', () => fs.writeFileSync('/workspace/h/f.bin', new Uint8Array([1, 2, 3])));
tryOp('writeProxy', () =>
  fs.writeFileSync('/workspace/h/p.bin', new Proxy(new Uint8Array([4, 5]), {})),
);
tryOp('writeProxyOpts', () =>
  fs.mkdirSync(
    '/workspace/h/q',
    new Proxy(
      { recursive: true },
      {
        get(t, k, r) {
          note('proxy get:r', r);
          return t[k];
        },
      },
    ),
  ),
);
tryOp('stat', () => fs.statSync('/workspace/h/f.bin'));
tryOp('lstat', () => fs.lstatSync('/workspace/h'));
tryOp('readdir', () => fs.readdirSync('/workspace/h', { withFileTypes: true }));
tryOp('read', () => fs.readFileSync('/workspace/h/f.bin'));
tryOp('readTpl', () => fs.readFileSync('/node_modules/pdf-lib/package.json'));
tryOp('exists', () => fs.existsSync('/workspace/h'));
tryOp('copy', () => fs.copyFileSync('/workspace/h/f.bin', '/workspace/h/g.bin'));
tryOp('cp', () => fs.cpSync('/workspace/h', '/workspace/h2', { recursive: true }));
tryOp('rename', () => fs.renameSync('/workspace/h/g.bin', '/workspace/h/r.bin'));
tryOp('utimes', () => fs.utimesSync('/workspace/h/r.bin', 1, 2));
tryOp('fd', () => {
  const fd = fs.openSync('/workspace/h/fd.bin', 'w+');
  fs.writeSync(fd, Buffer.from('xyz'));
  const b = Buffer.alloc(3);
  fs.readSync(fd, b, 0, 3, 0);
  fs.closeSync(fd);
  return b;
});
tryOp('rm', () => fs.rmSync('/workspace/h2', { recursive: true, force: true }));
tryOp('enoent', () => fs.readFileSync('/workspace/nope'));
tryOp('eexist', () => fs.mkdirSync('/workspace/h'));
tryOp('eisdir', () => fs.readFileSync('/workspace/h'));
// stack exhaustion: call fs at every depth while unwinding, the deepest call with no stack left
let depth = 0;
function rec() {
  depth++;
  try {
    rec();
  } catch (e) {
    note('so:own', e);
  }
  try {
    fs.existsSync('/workspace/h');
  } catch (e) {
    note('so:fs', e);
  }
}
try {
  rec();
} catch (e) {
  note('so:top', e);
}
console.log(
  JSON.stringify({ sync: true, depth, foreign: found.length, where: found.slice(0, 12) }),
);
// callbacks, promises, streams
fs.readFile('/workspace/h/f.bin', (err, d) => {
  note('cb:err', err);
  note('cb:data', d);
});
fs.promises.readFile('/workspace/h/f.bin').then(
  (d) => note('promise', d),
  (e) => note('promise:err', e),
);
fs.createReadStream('/workspace/h/f.bin')
  .on('data', (d) => note('stream', d))
  .on('error', (e) => note('stream:err', e));
setTimeout(() => {
  console.log(JSON.stringify({ async: true, foreign: found.length, where: found.slice(0, 12) }));
}, 20);
