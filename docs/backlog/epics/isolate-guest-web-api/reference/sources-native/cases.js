// Differential cases, evaluated as a classic script both in live Node and in a bare
// isolated-vm isolate carrying one candidate. Reads `__DATA` (WPT URL fixtures), defines
// `__runCases(only)` → Promise<JSON string>. Each result is a plain description, compared as text.
(() => {
  const g = globalThis;
  const ids = new Map();
  function describe(v, seen = new Map()) {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'number') return Object.is(v, -0) ? 'num:-0' : `num:${v}`;
    if (t === 'bigint') return `big:${v}n`;
    if (t === 'string') return `str:${JSON.stringify(v)}`;
    if (t === 'undefined' || t === 'boolean') return `${t}:${v}`;
    if (t === 'symbol') return `sym:${String(v)}`;
    if (t === 'function') return `fn:${v.name}`;
    if (seen.has(v)) return `ref#${seen.get(v)}`;
    seen.set(v, seen.size);
    const tag = Object.prototype.toString.call(v);
    const proto = Object.getPrototypeOf(v);
    const protoName = proto === null ? 'null' : (proto.constructor?.name ?? '?');
    const out = { tag, proto: protoName };
    if (v instanceof Date) out.time = v.getTime();
    else if (v instanceof RegExp) Object.assign(out, { source: v.source, flags: v.flags, lastIndex: v.lastIndex });
    else if (v instanceof Map) out.entries = [...v].map(([k, x]) => [describe(k, seen), describe(x, seen)]);
    else if (v instanceof Set) out.values = [...v].map((x) => describe(x, seen));
    else if (v instanceof ArrayBuffer)
      Object.assign(out, { byteLength: v.byteLength, resizable: v.resizable, maxByteLength: v.maxByteLength, bytes: [...new Uint8Array(v)] });
    else if (ArrayBuffer.isView(v))
      Object.assign(out, { byteOffset: v.byteOffset, byteLength: v.byteLength, bufferLength: v.buffer.byteLength, bytes: [...new Uint8Array(v.buffer, v.byteOffset, v.byteLength)] });
    else if (v instanceof Error)
      Object.assign(out, { name: v.name, message: v.message, hasCause: 'cause' in v, cause: 'cause' in v ? describe(v.cause, seen) : undefined, stackType: typeof v.stack });
    else if (['[object Number]', '[object String]', '[object Boolean]', '[object BigInt]'].includes(tag)) out.value = describe(v.valueOf(), seen);
    const keys = Reflect.ownKeys(v).filter((k) => !(ArrayBuffer.isView(v) && typeof k === 'string' && /^\d+$/.test(k)));
    out.own = keys
      .filter((k) => !(v instanceof Error && (k === 'stack' || k === 'message' || k === 'cause')))
      .map((k) => {
        const d = Object.getOwnPropertyDescriptor(v, k);
        const kind = 'value' in d ? describe(d.value, seen) : 'accessor';
        return `${String(k)}${d.enumerable ? '' : '(ne)'}=${kind}`;
      });
    if (Array.isArray(v)) out.length = v.length;
    return out;
  }
  function err(e) {
    if (e === null || typeof e !== 'object') return { threw: describe(e) };
    return {
      threw: e.constructor?.name,
      name: e.name,
      message: e.message,
      code: e.code,
      isDOMException: typeof DOMException === 'function' && e instanceof DOMException,
    };
  }
  function attempt(fn) {
    try {
      return { ok: fn() };
    } catch (e) {
      return err(e);
    }
  }
  async function attemptAsync(fn) {
    try {
      return { ok: await fn() };
    } catch (e) {
      return err(e);
    }
  }
  const URL_FIELDS = ['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'];
  const urlFields = (u) => Object.fromEntries(URL_FIELDS.map((f) => [f, u[f]]));

  const suites = {
    url() {
      const out = [];
      for (const c of __DATA.urltestdata) {
        if (typeof c !== 'object') continue;
        out.push([`${c.input} @ ${c.base}`, attempt(() => urlFields(c.base == null ? new URL(c.input) : new URL(c.input, c.base)))]);
      }
      return out;
    },
    urlSetters() {
      const out = [];
      for (const [setter, list] of Object.entries(__DATA.setters)) {
        if (setter === 'comment') continue;
        for (const c of list) {
          out.push([`${setter} ${c.href} := ${c.new_value}`, attempt(() => {
            const u = new URL(c.href);
            u[setter] = c.new_value;
            return urlFields(u);
          })]);
        }
      }
      return out;
    },
    urlShape() {
      return [
        ['statics', attempt(() => ['canParse', 'parse', 'createObjectURL', 'revokeObjectURL'].map((k) => `${k}:${typeof URL[k]}`))],
        ['canParse', attempt(() => [URL.canParse('a:b'), URL.canParse('x', 'nope'), URL.canParse('/x', 'https://a')])],
        ['URL.parse', attempt(() => [URL.parse('nope'), URL.parse('/x', 'https://a')?.href])],
        ['invalid', attempt(() => new URL('nope'))],
        ['no-arg', attempt(() => new URL())],
        ['call', attempt(() => URL('https://a'))],
        ['toString/toJSON', attempt(() => { const u = new URL('https://a/b'); return [String(u), u.toJSON(), JSON.stringify({ u })]; })],
        ['tag', attempt(() => Object.prototype.toString.call(new URL('https://a')))],
        ['own keys', attempt(() => Reflect.ownKeys(new URL('https://a')).map(String))],
        ['proto keys', attempt(() => Reflect.ownKeys(URL.prototype).map(String).sort())],
        ['searchParams link', attempt(() => { const u = new URL('https://a/?x=1'); u.searchParams.append('y', '2 3'); const s = u.href; u.search = '?q=9'; return [s, u.searchParams.get('q'), u.searchParams === u.searchParams]; })],
        ['href setter invalid', attempt(() => { const u = new URL('https://a'); u.href = 'nope'; return u.href; })],
        ['length', attempt(() => [URL.length, URL.name])],
      ];
    },
    usp() {
      const P = URLSearchParams;
      const s = (p) => p.toString();
      return [
        ['getAll', attempt(() => new P('a=1&b=2&a=3').getAll('a'))],
        ['space plus', attempt(() => s(new P({ 'a b': 'c d' })))],
        ['plus decode', attempt(() => new P('a=b+c').get('a'))],
        ['bad percent', attempt(() => new P('a=%zz&b=%41').getAll('a').concat(new P('b=%41').get('b')))],
        ['leading ?', attempt(() => s(new P('?a=1')))],
        ['record', attempt(() => s(new P({ a: 1, b: [2, 3] })))],
        ['pairs', attempt(() => s(new P([['a', '1'], ['b', '2']])))],
        ['bad pair', attempt(() => new P([['a']]))],
        ['iterable map', attempt(() => s(new P(new Map([['x', 'y']]))))],
        ['sort stable', attempt(() => { const p = new P('z=1&a=2&z=0&a=1'); p.sort(); return s(p); })],
        ['sort code units', attempt(() => { const p = new P('ﬃ=1&\u{1F308}=2&�=3&a=4'); p.sort(); return [...p.keys()]; })],
        ['append/set/delete', attempt(() => { const p = new P('a=1&a=2&b=3'); p.append('c', '4'); p.set('a', '9'); p.delete('b'); return s(p); })],
        ['delete value', attempt(() => { const p = new P('a=1&a=2'); p.delete('a', '1'); return s(p); })],
        ['has value', attempt(() => { const p = new P('a=1'); return [p.has('a', '1'), p.has('a', '2'), p.has('a')]; })],
        ['size', attempt(() => [new P('a=1&b=2&a=3').size, new P({}).size, typeof Object.getOwnPropertyDescriptor(P.prototype, 'size')?.get])],
        ['encode set', attempt(() => s(new P({ k: "~*-._!'()&=+ €/?#%" })))],
        ['lone surrogate', attempt(() => s(new P({ k: '\uD800x' })))],
        ['iteration', attempt(() => { const p = new P('b=2&a=1'); const f = []; p.forEach((v, k) => f.push(k + v)); return [[...p], [...p.keys()], [...p.values()], [...p.entries()], f]; })],
        ['empty', attempt(() => [s(new P()), s(new P('')), s(new P(undefined))])],
        ['null', attempt(() => s(new P(null)))],
        ['key only', attempt(() => [s(new P('a')), s(new P('=a')), new P('=a').get('')])],
        ['ampersands', attempt(() => s(new P('&&a=1&&')))],
        ['tag', attempt(() => [Object.prototype.toString.call(new P()), Object.prototype.toString.call(new P()[Symbol.iterator]())])],
        ['missing', attempt(() => [new P('a=1').get('b'), new P('a=1').has('b')])],
        ['coerce', attempt(() => { const p = new P(); p.append(1, 2); p.append(null, undefined); return s(p); })],
        ['utf8', attempt(() => [s(new P({ a: 'é' })), new P('a=%C3%A9').get('a')])],
        ['call no new', attempt(() => URLSearchParams())],
        ['no args append', attempt(() => new P().append('a'))],
        ['proto keys', attempt(() => Reflect.ownKeys(P.prototype).map(String).sort())],
        ['inspect-free toString of object', attempt(() => s(new P({ toString() { return 'x=y'; } })))],
      ];
    },
    clone() {
      const sc = (v, o) => (o === undefined ? structuredClone(v) : structuredClone(v, o));
      const d = (fn) => attempt(() => describe(fn()));
      const cyc = { a: 1 };
      cyc.self = cyc;
      const shared = { s: 1 };
      class K { constructor() { this.x = 1; } m() {} }
      const re = /a/gi;
      re.lastIndex = 3;
      const sparse = [1, , 3];
      sparse.x = 1;
      const getter = { get g() { return 7; } };
      const ne = {};
      Object.defineProperty(ne, 'h', { value: 1, enumerable: false });
      const sym = { [Symbol('s')]: 1, v: 2 };
      const e1 = new Error('m', { cause: { c: 1 } });
      const e3 = new Error('n');
      e3.name = 'Foo';
      e3.extra = 1;
      return [
        ['primitives', d(() => sc([1, -0, NaN, 's', true, null, undefined, 10n]))],
        ['date', d(() => sc(new Date(5)))],
        ['regexp lastIndex', d(() => sc(re))],
        ['map', d(() => { const k = { k: 1 }; return sc(new Map([[k, k], ['a', 1]])); })],
        ['set', d(() => sc(new Set([1, 'a', { b: 1 }])))],
        ['cycle', d(() => sc(cyc))],
        ['shared ref', d(() => sc({ a: shared, b: shared }))],
        ['subarray', d(() => sc(new Uint8Array([1, 2, 3, 4]).subarray(1, 3)))],
        ['float64', d(() => sc(new Float64Array([1.5, -0])))],
        ['bigint64', d(() => sc(new BigInt64Array([1n])))],
        ['dataview', d(() => sc(new DataView(new ArrayBuffer(4), 1, 2)))],
        ['resizable ab', d(() => sc(new ArrayBuffer(8, { maxByteLength: 16 })))],
        ['error cause', d(() => sc(e1))],
        ['typeerror', d(() => sc(new TypeError('t')))],
        ['custom error name', d(() => sc(e3))],
        ['aggregate', d(() => sc(new AggregateError([1], 'agg')))],
        ['sparse', d(() => sc(sparse))],
        ['getter', d(() => sc(getter))],
        ['non-enumerable', d(() => sc(ne))],
        ['symbol key', d(() => sc(sym))],
        ['function', d(() => sc(() => 1))],
        ['symbol value', d(() => sc(Symbol('x')))],
        ['class instance', d(() => sc(new K()))],
        ['boxed', d(() => sc([Object(1), Object('s'), Object(true), Object(1n)]))],
        ['transfer', d(() => { const b = new ArrayBuffer(4); const c = sc(b, { transfer: [b] }); return [b.byteLength, c.byteLength]; })],
        ['transfer bad', d(() => sc(1, { transfer: [{}] }))],
        ['no args', d(() => structuredClone())],
        ['options non-object', d(() => sc(1, 5))],
        ['weakmap', d(() => sc(new WeakMap()))],
        ['promise', d(() => sc(Promise.resolve()))],
        ['null proto', d(() => sc(Object.create(null)))],
        ['nested dates', d(() => sc([{ d: new Date(1) }, [new Date(2)]]))],
        ['length/name', attempt(() => [structuredClone.length, structuredClone.name])],
      ];
    },
    async blob() {
      const B = Blob;
      const t = (b) => b.text();
      const bytes = async (b) => [...new Uint8Array(await b.arrayBuffer())];
      const cases = [
        ['parts', () => t(new B(['ab', new Uint8Array([99]), new B(['d']), new Uint16Array([0x6665]).buffer]))],
        ['size', () => new B(['ab', new Uint8Array(3)]).size],
        ['type lower', () => [new B([], { type: 'Text/Plain' }).type, new B([], { type: 'té' }).type, new B([], { type: 'a\u0019b' }).type]],
        ['slice', async () => [await t(new B(['abcdef']).slice(1, 3)), await t(new B(['abcdef']).slice(-2)), new B(['abc']).slice(0, 1, 'X/Y').type, new B(['abc']).slice(2, 1).size]],
        ['arrayBuffer', () => bytes(new B(['é']))],
        ['bytes', async () => (typeof B.prototype.bytes === 'function' ? [...(await new B(['a']).bytes())] : 'no bytes()')],
        ['endings', async () => [await t(new B(['a\r\nb\rc\n'], { endings: 'native' })), await t(new B(['a\r\nb'], { endings: 'transparent' }))]],
        ['endings invalid', () => new B([], { endings: 'x' })],
        ['not sequence', () => new B('abc')],
        ['number part', () => t(new B([123]))],
        ['lone surrogate', () => bytes(new B(['\uD800']))],
        ['file', () => { const f = new File(['a'], 'n.txt', { type: 'X/y', lastModified: 5 }); return [f.name, f.lastModified, f.type, f.size, f instanceof B, Object.prototype.toString.call(f)]; }],
        ['file default lastModified', () => typeof new File([], 'n').lastModified],
        ['file no name', () => new File(['a'])],
        ['tag', () => [Object.prototype.toString.call(new B()), B.name, B.length, File.length]],
        ['stream typeof', () => typeof new B().stream],
        ['text on non-blob', () => B.prototype.text.call({})],
        ['proto keys', () => Reflect.ownKeys(B.prototype).map(String).sort()],
        ['call no new', () => B()],
      ];
      const out = [];
      for (const [name, fn] of cases) out.push([name, await attemptAsync(fn)]);
      return out;
    },
  };
  g.__runCases = async (only) => {
    const res = {};
    for (const name of only) res[name] = await attemptAsync(() => suites[name]());
    return JSON.stringify(res);
  };
})();
