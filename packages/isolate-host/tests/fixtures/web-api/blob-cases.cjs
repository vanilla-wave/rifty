// Isolate guest Blob/File (ADR-0578): one line per observation (`id<TAB>outcome`), run
// unchanged by `node`, a sandbox `exec` and `runCode`. Outcome: a value's description or the
// throw's `name [code]: message`.
'use strict';
const buffer = require('node:buffer');
const fs = require('node:fs');

const lines = [];
const thrown = (e) => {
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return `throw ${String(e)}`;
  const code = e.code === undefined ? '' : ` [${e.code}]`;
  return `throw ${e.name}${code}: ${String(e.message).split('\n')[0]}`;
};
function desc(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (typeof v === 'symbol') return v.toString();
  if (typeof v === 'function') return `function ${v.name}`;
  if (Array.isArray(v)) return `[${v.map(desc).join(', ')}]`;
  if (v instanceof Uint8Array) return `Uint8Array[${Array.from(v).join(',')}]`;
  if (v instanceof ArrayBuffer)
    return `ArrayBuffer(${v.byteLength})[${Array.from(new Uint8Array(v)).join(',')}]`;
  const proto = Object.getPrototypeOf(v);
  return `object ${proto?.constructor?.name ?? 'null-proto'}`;
}
const pin = (id, fn) => {
  let out;
  try {
    out = desc(fn());
  } catch (e) {
    out = thrown(e);
  }
  lines.push(`${id}\t${out}`);
};
const pinAsync = async (id, fn) => {
  let out;
  try {
    out = desc(await fn());
  } catch (e) {
    out = thrown(e);
  }
  lines.push(`${id}\t${out}`);
};
const descriptor = (o, k) => {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (!d) return 'absent';
  if ('value' in d)
    return `data ${typeof d.value} w${+d.writable}e${+d.enumerable}c${+d.configurable}`;
  return `accessor get:${typeof d.get} set:${typeof d.set} e${+d.enumerable}c${+d.configurable}`;
};
/** Microtask turns until `blob.arrayBuffer()` has settled (the byte store's read count). */
async function turns(blob) {
  let n = 0;
  let done = false;
  const p = blob.arrayBuffer().then(() => {
    done = true;
  });
  while (!done && n < 100) {
    await null;
    n++;
  }
  await p;
  return n;
}

async function main() {
  // --- the unit's pin table ---
  pin('global Blob descriptor', () => descriptor(globalThis, 'Blob'));
  pin('global File descriptor', () => descriptor(globalThis, 'File'));
  pin('new Blob(["a"])', () => new Blob(['a']));
  pin('blob.size/type', () => {
    const b = new Blob(['ab', new Uint8Array([99])], { type: 'Text/Plain' });
    return `${b.size} ${b.type}`;
  });
  await pinAsync('blob.text()', () => new Blob(['h', 'é']).text());
  await pinAsync('blob.arrayBuffer()', () => new Blob(['abc']).arrayBuffer());
  await pinAsync('blob.bytes()', () => new Blob(['abc']).bytes());
  await pinAsync('blob.slice(1,2).text()', () => new Blob(['abc']).slice(1, 2).text());
  pin('blob.stream()', () => new Blob(['abc']).stream());
  pin('new File(["x"],"n",{lastModified:5})', () => {
    const f = new File(['x'], 'n', { lastModified: 5 });
    return `${f.name} ${f.lastModified} ${f.size}`;
  });
  pin('typeof buffer.Blob', () => typeof buffer.Blob);
  pin('typeof buffer.File', () => typeof buffer.File);
  pin('buffer.Blob === Blob', () => buffer.Blob === Blob);
  pin('buffer.File === File', () => buffer.File === File);
  pin('new buffer.Blob(["a"]).size', () => new buffer.Blob(['a']).size);
  pin('({}) instanceof Blob', () => ({}) instanceof Blob);
  pin('({}) instanceof buffer.Blob', () => ({}) instanceof buffer.Blob);
  pin('typeof buffer.resolveObjectURL', () => typeof buffer.resolveObjectURL);
  pin(
    'buffer Blob/File descriptors',
    () => `${descriptor(buffer, 'Blob')} | ${descriptor(buffer, 'File')}`,
  );

  // --- Node behaviours beyond WPT ---
  await pinAsync('endings native, lone \\r', () =>
    new Blob(['a\rb\r\nc\nd'], { endings: 'native' }).text(),
  );
  await pinAsync('endings transparent', () =>
    new Blob(['a\rb\r\nc'], { endings: 'transparent' }).text(),
  );
  pin('endings invalid', () => new Blob([], { endings: 'x' }));
  pin('type lower-cased', () => new Blob([], { type: 'TEXT/Plain' }).type);
  pin('type non-ASCII → ""', () => new Blob([], { type: 'aé' }).type);
  pin('type control char → ""', () => new Blob([], { type: 'a\u0001' }).type);
  pin('type object coerced', () => new Blob([], { type: { toString: () => 'X/Y' } }).type);
  await pinAsync('bytes() of two parts', () => new Blob(['a', new Uint8Array([1, 2])]).bytes());
  await pinAsync('slice(-2)', () => new Blob(['abc']).slice(-2).text());
  pin('slice(5, 1).size', () => new Blob(['abc']).slice(5, 1).size);
  pin('slice(-10, -1).size', () => new Blob(['abc']).slice(-10, -1).size);
  pin('slice(1.9, NaN).size', () => new Blob(['abc']).slice(1.9, Number.NaN).size);
  pin('slice(0, 2**64).size', () => new Blob(['abc']).slice(0, 2 ** 64).size);
  pin('slice(0, 2, "A/B").type', () => new Blob(['abc']).slice(0, 2, 'A/B').type);
  pin('slice(0, 2, "é").type', () => new Blob(['abc']).slice(0, 2, 'é').type);
  pin('slice result constructor', () => new Blob(['abc']).slice().constructor === Blob);
  pin('slice of a File', () => {
    const s = new File(['abc'], 'n').slice(1);
    return `${Object.prototype.toString.call(s)} ${s instanceof File} ${s.size}`;
  });
  pin('File default lastModified is Date.now() at construction', () => {
    const before = Date.now();
    const f = new File([], 'n');
    const after = Date.now();
    return `${typeof f.lastModified} ${f.lastModified >= before && f.lastModified <= after}`;
  });
  pin('File lastModified coercion', () =>
    [
      new File([], 'n', { lastModified: '7' }).lastModified,
      new File([], 'n', { lastModified: 'x' }).lastModified,
      new File([], 'n', { lastModified: 2n ** 3n }).lastModified,
    ].join(' '),
  );
  pin('File name coercion', () =>
    [new File([], 5).name, new File([], null).name, new File([], 'a\uD800').name]
      .map(desc)
      .join(' '),
  );
  pin('new File([], Symbol())', () => new File([], Symbol()));
  pin('new File([])', () => new File([]));
  pin('new Blob([Symbol()])', () => new Blob([Symbol()]));
  pin('new Blob(5)', () => new Blob(5));
  pin('new Blob("ab")', () => new Blob('ab'));
  pin('new Blob([], 5)', () => new Blob([], 5));
  pin('new Blob([], null).size', () => new Blob([], null).size);
  pin('part coercion', () => new Blob([{ toString: () => 'xy' }, 1, null]).size);
  await pinAsync('ArrayBuffer/DataView/Blob parts', () =>
    new Blob([
      new ArrayBuffer(2),
      new DataView(new ArrayBuffer(3), 1),
      new Blob(['z']),
      new Uint16Array([0x6162]),
    ]).bytes(),
  );
  await pinAsync('lone surrogate part', () => new Blob(['\uD800']).bytes());
  pin('Blob toStringTag', () => Object.prototype.toString.call(new Blob()));
  pin('File toStringTag', () => Object.prototype.toString.call(new File([], 'n')));
  pin('Blob.prototype names', () => Object.getOwnPropertyNames(Blob.prototype).join());
  pin('File.prototype names', () => Object.getOwnPropertyNames(File.prototype).join());
  pin('Blob.prototype symbols', () =>
    Object.getOwnPropertySymbols(Blob.prototype).map(String).join(),
  );
  pin('File.prototype symbols', () =>
    Object.getOwnPropertySymbols(File.prototype).map(String).join(),
  );
  pin('Blob.prototype descriptors', () =>
    ['size', 'type', 'slice', 'stream', 'text', 'arrayBuffer', 'bytes', Symbol.toStringTag]
      .map((k) => descriptor(Blob.prototype, k))
      .join(' | '),
  );
  pin('File.prototype descriptors', () =>
    ['name', 'lastModified', Symbol.toStringTag]
      .map((k) => descriptor(File.prototype, k))
      .join(' | '),
  );
  pin('constructor length/name', () => `${Blob.length} ${File.length} ${Blob.name} ${File.name}`);
  pin(
    'File extends Blob',
    () =>
      Object.getPrototypeOf(File) === Blob &&
      Object.getPrototypeOf(File.prototype) === Blob.prototype,
  );
  pin('blob own keys', () =>
    Reflect.ownKeys(new Blob(['a']))
      .map(String)
      .join(),
  );
  pin(
    'Object.keys / JSON',
    () => `${Object.keys(new Blob(['a'])).length} ${JSON.stringify(new Blob(['a']))}`,
  );
  pin('Blob() without new', () => Blob());
  pin('size getter on a non-Blob', () => Reflect.get(Blob.prototype, 'size', {}));
  pin('name getter on a Blob', () =>
    Object.getOwnPropertyDescriptor(File.prototype, 'name').get.call(new Blob()),
  );
  await pinAsync('text() on a non-Blob rejects', () => Blob.prototype.text.call({}));
  pin('ERR_INVALID_THIS shape', () => {
    try {
      Blob.prototype.slice.call({});
    } catch (e) {
      return `${e instanceof TypeError} ${e.constructor === TypeError} ${String(e)} ${Object.keys(e)} ${e.stack.split('\n')[0]}`;
    }
  });
  pin('ERR_INVALID_ARG_VALUE stack header', () => {
    try {
      new Blob([], { endings: 'x' });
    } catch (e) {
      return e.stack.split('\n')[0];
    }
  });
  pin('sequence error shape', () => {
    try {
      new Blob(5);
    } catch (e) {
      return `${Object.getPrototypeOf(e) === TypeError.prototype} ${e.code} ${e.stack.split('\n')[0]}`;
    }
  });
  pin('iterable blobParts', () => new Blob(new Set(['a', 'b'])).size);
  pin('URL.createObjectURL', () => URL.createObjectURL(new Blob()));

  // --- the byte store's reads: microtask turns until arrayBuffer() settles ---
  const abc = () => new Blob(['a', 'b', 'c']);
  for (const [id, make] of [
    ['[]', () => new Blob([])],
    ['[a]', () => new Blob(['a'])],
    ['[a,b,c]', abc],
    ["['','']", () => new Blob(['', ''])],
    ['[blob(a,b),c]', () => new Blob([new Blob(['a', 'b']), 'c'])],
    ['abc.slice(1,2)', () => abc().slice(1, 2)],
    ['abc.slice(0,1)', () => abc().slice(0, 1)],
    ['abc.slice(1,3)', () => abc().slice(1, 3)],
    ['abc.slice(1,1)', () => abc().slice(1, 1)],
    ['abc.slice(1).slice(0,1)', () => abc().slice(1).slice(0, 1)],
    ["[a,'',b].slice(1,2)", () => new Blob(['a', '', 'b']).slice(1, 2)],
    ["[a,'',b].slice(0,1)", () => new Blob(['a', '', 'b']).slice(0, 1)],
    ['[xx,yy,zz].slice(3,5)', () => new Blob(['xx', 'yy', 'zz']).slice(3, 5)],
    ['1 MiB part', () => new Blob([new Uint8Array(2 ** 20)])],
  ])
    lines.push(`turns ${id}\t${await turns(make())}`);
  for (const [id, make] of [
    ["[blob(),'a']", () => new Blob([new Blob([]), 'a'])],
    ['[a,blob(),b]', () => new Blob(['a', new Blob([]), 'b'])],
    ['[blob(),blob()]', () => new Blob([new Blob([]), new Blob([])])],
    ["[blob(a).slice(1),'b']", () => new Blob([new Blob(['a']).slice(1), 'b'])],
    ["[abc.slice(1,1),'x']", () => new Blob([abc().slice(1, 1), 'x'])],
    ['[blob(a,b),c].slice(1,3)', () => new Blob([new Blob(['a', 'b']), 'c']).slice(1, 3)],
    ['[blob(a,b),c].slice(2,3)', () => new Blob([new Blob(['a', 'b']), 'c']).slice(2, 3)],
    ['[blob(a,b),c].slice(0,2)', () => new Blob([new Blob(['a', 'b']), 'c']).slice(0, 2)],
    ['[x,blob(a,b)].slice(1)', () => new Blob(['x', new Blob(['a', 'b'])]).slice(1)],
    ['[blob(blob(a),b)]', () => new Blob([new Blob([new Blob(['a']), 'b'])])],
  ])
    lines.push(`turns ${id}\t${await turns(make())}`);
  {
    const order = [];
    const b1 = new Blob(['a', 'b']).text().then(() => order.push('two parts'));
    const b2 = new Blob(['ab']).text().then(() => order.push('one part'));
    const b3 = Promise.resolve().then(() => order.push('a microtask'));
    await Promise.all([b1, b2, b3]);
    lines.push(`settle order\t${order.join(', ')}`);
  }

  // --- the store owns its parts, and holds many ---
  await pinAsync('150 000 parts, then nested', () => {
    const parts = [];
    for (let i = 0; i < 150000; i++) parts.push(`${i},`);
    const b = new Blob(parts);
    return new File([b, new Blob([b.slice(3)])], 'x')
      .text()
      .then((t) => `${t.length} ${t.slice(0, 8)}`);
  });
  pin('b = new Blob([b, b]) 24 times', () => {
    let b = new Blob(['ab']);
    for (let i = 0; i < 24; i++) b = new Blob([b, b]);
    return b.size;
  });
  await pinAsync('species buffer of a part', async () => {
    let kept;
    class Evil extends ArrayBuffer {
      static get [Symbol.species]() {
        return (n) => {
          kept = new ArrayBuffer(n);
          return kept;
        };
      }
    }
    const b = new Blob([new Evil(3)]);
    const detached = kept.byteLength === 0;
    if (!detached) new Uint8Array(kept)[0] = 42;
    return `${detached} ${Array.from(await b.bytes())}`;
  });
  await pinAsync('a forged blob part', async () => {
    const kHandle = Object.getOwnPropertySymbols(new Blob()).find(
      (s) => s.description === 'kHandle',
    );
    const u8 = new Uint8Array([1, 2, 3]);
    const b = new Blob([{ [kHandle]: u8, size: 3 }]);
    return `${u8.byteLength} ${b.size}`;
  });
  await pinAsync('slice under a replaced Math.max/min', async () => {
    const { max, min } = Math;
    Math.max = Math.min = () => 0;
    try {
      return await new Blob(['ab', 'cd', 'ef']).slice(1, 5).text();
    } finally {
      Math.max = max;
      Math.min = min;
    }
  });
  await pinAsync('read under a replaced array iterator', async () => {
    const b = new Blob(['ab', 'cd', 'ef']);
    const proto = Object.getPrototypeOf([][Symbol.iterator]());
    const next = proto.next;
    proto.next = () => ({ done: true });
    let p;
    try {
      p = b.slice(1, 5).arrayBuffer();
    } finally {
      proto.next = next;
    }
    return p;
  });
  await pinAsync('SharedArrayBuffer part', () => new Blob([new SharedArrayBuffer(3)]).bytes());
  await pinAsync('view on a SharedArrayBuffer part', () => {
    const sab = new SharedArrayBuffer(4);
    new Uint8Array(sab).set([1, 2, 3, 4]);
    return new Blob([new Uint8Array(sab, 1, 2), new DataView(sab, 3)]).bytes();
  });
  await pinAsync('growable SharedArrayBuffer part', () => {
    const sab = new SharedArrayBuffer(2, { maxByteLength: 8 });
    new Uint8Array(sab).set([7, 8]);
    return new Blob([sab]).bytes();
  });
  // Not read: reading ~3000 nested levels crashes Node v24.16.0 itself (SIGSEGV).
  pin('5000 nested blobs, sliced', () => {
    let b = new Blob(['abc']);
    for (let i = 0; i < 5000; i++) b = new Blob([b]);
    return `${b.slice(1).size} ${b.slice(1).slice(0, 1).size}`;
  });
  pin('File name under a replaced RegExp exec', () => {
    const exec = RegExp.prototype.exec;
    RegExp.prototype.exec = () => null;
    try {
      return Array.from(new File([], 'a\uD800b').name, (c) => c.charCodeAt(0)).join();
    } finally {
      RegExp.prototype.exec = exec;
    }
  });
  pin('ERR_INVALID_THIS own keys', () => {
    try {
      Blob.prototype.slice.call({});
    } catch (e) {
      return Reflect.ownKeys(e).map(String).join();
    }
  });
  pin('validateDictionary error shape', () => {
    try {
      new Blob([], 5);
    } catch (e) {
      const chain = [];
      for (
        let p = Object.getPrototypeOf(e);
        p !== TypeError.prototype;
        p = Object.getPrototypeOf(p)
      )
        chain.push(Object.getOwnPropertyNames(p).join('|'));
      return `${Reflect.ownKeys(e).map(String)} ${chain.join(' / ')} ${e.stack.split('\n')[1].trim().split(' (')[0]}`;
    }
  });
  pin('ERR_INVALID_ARG_VALUE of a long value', () => new Blob([], { endings: 'x'.repeat(200) }));
  pin('ERR_INVALID_ARG_VALUE of a lone surrogate', () => new Blob([], { endings: '\ud800' }));

  // --- module consumers ---
  await pinAsync('stream/consumers.blob', async () => {
    const { Readable } = require('node:stream');
    const b = await require('node:stream/consumers').blob(Readable.from(['ab', 'c']));
    return `${Object.prototype.toString.call(b)} ${b.size} ${JSON.stringify(b.type)} ${await b.text()}`;
  });
  await pinAsync('stream/consumers.blob under a replaced global Blob', async () => {
    const { Readable } = require('node:stream');
    const real = globalThis.Blob;
    globalThis.Blob = class Fake {};
    try {
      const b = await require('node:stream/consumers').blob(Readable.from(['x']));
      return b instanceof real;
    } finally {
      globalThis.Blob = real;
    }
  });
  fs.writeFileSync('blob-cases.txt', 'abc');
  await pinAsync('fs.openAsBlob', async () => {
    const b = await fs.openAsBlob('blob-cases.txt', { type: 'Text/X' });
    return `${b instanceof Blob} ${b.size} ${b.type} ${await b.text()}`;
  });
  await pinAsync('fs.openAsBlob after an overwrite', async () => {
    const b = await fs.openAsBlob('blob-cases.txt');
    fs.writeFileSync('blob-cases.txt', 'xyz!');
    return b.text();
  });
  pin('buffer.resolveObjectURL', () => buffer.resolveObjectURL('blob:nodedata:x'));

  require('node:fs').writeSync(1, `${lines.join('\n')}\n`);
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
