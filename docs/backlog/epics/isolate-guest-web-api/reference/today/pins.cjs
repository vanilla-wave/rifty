// One line per observation: `id<TAB>outcome`. Runs unchanged under `node pins.cjs` and as a
// sandbox `exec` (encodings.json next to it). Outcome: a value's short description, or the throw's
// `name [code]: message` (first line).
'use strict';
const ENCODINGS = require('./encodings.json');

const firstLine = (s) => String(s).split('\n')[0];
function thrown(e) {
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return `throw ${String(e)}`;
  const code = e.code === undefined ? '' : ` [${e.code}]`;
  return `throw ${e.name}${code}: ${firstLine(e.message)}`;
}
function desc(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (typeof v === 'function') return `function ${v.name}`;
  if (v instanceof Uint8Array) return `Uint8Array[${Array.from(v).join(',')}]`;
  if (v instanceof ArrayBuffer) return `ArrayBuffer(${v.byteLength})`;
  const proto = Object.getPrototypeOf(v);
  return `object ${proto?.constructor?.name ?? 'null-proto'}`;
}
const lines = [];
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
const descriptor = (name) => {
  const d = Object.getOwnPropertyDescriptor(globalThis, name);
  if (!d) return 'absent';
  if ('value' in d)
    return `data ${typeof d.value} w${+d.writable}e${+d.enumerable}c${+d.configurable}`;
  return `accessor e${+d.enumerable}c${+d.configurable}`;
};

async function main() {
  const NAMES = [
    'Blob',
    'File',
    'TextDecoder',
    'TextEncoder',
    'AbortController',
    'AbortSignal',
    'EventTarget',
    'Event',
    'CustomEvent',
    'DOMException',
  ];
  for (const n of NAMES) pin(`global ${n} descriptor`, () => descriptor(n));

  // --- Blob / File ---
  const buffer = require('node:buffer');
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
  pin('buffer.Blob === Blob', () => buffer.Blob === globalThis.Blob);
  pin('buffer.File === File', () => buffer.File === globalThis.File);
  pin('new buffer.Blob(["a"]).size', () => new buffer.Blob(['a']).size);
  pin('({}) instanceof Blob', () => ({}) instanceof Blob);
  pin('({}) instanceof buffer.Blob', () => ({}) instanceof buffer.Blob);
  pin('buffer.resolveObjectURL', () => typeof buffer.resolveObjectURL);

  // --- TextDecoder ---
  const util = require('node:util');
  pin('util.TextDecoder === TextDecoder', () => util.TextDecoder === globalThis.TextDecoder);
  pin('util.TextEncoder === TextEncoder', () => util.TextEncoder === globalThis.TextEncoder);
  let labels = 0;
  let accepted = 0;
  const byName = {};
  for (const [name, ls] of ENCODINGS) {
    for (const label of ls) {
      labels++;
      try {
        const td = new TextDecoder(label);
        accepted++;
        byName[name] = byName[name] ?? `ok as ${td.encoding}`;
      } catch (e) {
        byName[name] = byName[name] ?? thrown(e);
      }
    }
  }
  lines.push(`TextDecoder labels accepted\t${accepted}/${labels}`);
  for (const label of ENCODINGS[0][1])
    pin(`TextDecoder(${JSON.stringify(label)}).encoding`, () => new TextDecoder(label).encoding);
  for (const [name] of ENCODINGS) lines.push(`TextDecoder(${name})\t${byName[name]}`);
  const BYTES = new Uint8Array([0x68, 0x69, 0xe9, 0x80, 0xff]);
  for (const label of ['latin1', 'utf-16le', 'utf-16be', 'shift_jis', 'gbk', 'big5', 'euc-kr'])
    pin(`decode ${label} 68 69 e9 80 ff`, () => new TextDecoder(label).decode(BYTES));
  pin('utf-8 fatal on ff', () => new TextDecoder('utf-8', { fatal: true }).decode(BYTES));
  pin('utf-8 ignoreBOM', () =>
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])),
  );
  pin('utf-8 stream split é', () => {
    const td = new TextDecoder();
    return td.decode(new Uint8Array([0xc3]), { stream: true }) + td.decode(new Uint8Array([0xa9]));
  });
  pin('new TextDecoder("nope")', () => new TextDecoder('nope'));

  // --- Abort / events ---
  pin('new AbortController()', () => new AbortController());
  pin('AbortSignal.abort().reason', () => AbortSignal.abort().reason);
  pin('AbortSignal.timeout(1)', () => AbortSignal.timeout(1));
  pin('AbortSignal.any([])', () => AbortSignal.any([]));
  pin('throwIfAborted', () => AbortSignal.abort('r').throwIfAborted());
  pin('new EventTarget()', () => new EventTarget());
  pin('new Event("x").type', () => new Event('x').type);
  pin('new CustomEvent("x",{detail:1}).detail', () => new CustomEvent('x', { detail: 1 }).detail);
  pin('new DOMException("m","AbortError").code', () => new DOMException('m', 'AbortError').code);

  const events = require('node:events');
  pin('typeof events.addAbortListener', () => typeof events.addAbortListener);
  pin('typeof util.aborted', () => typeof util.aborted);
  // A signal from Node's own APIs, no global needed: an already-aborted fake is not Node's.
  let sig;
  try {
    sig = new AbortController().signal;
  } catch {}
  await pinAsync('events.once(ee,"x",{signal}) aborted', async () => {
    const ac = new AbortController();
    const p = events.once(new events.EventEmitter(), 'x', { signal: ac.signal });
    ac.abort();
    return p;
  });
  await pinAsync('events.on(ee,"x",{signal}) aborted', async () => {
    const ac = new AbortController();
    const it = events.on(new events.EventEmitter(), 'x', { signal: ac.signal });
    ac.abort();
    return it.next();
  });
  await pinAsync('timers/promises.setTimeout(5,v,{signal}) aborted', async () => {
    const ac = new AbortController();
    const p = require('node:timers/promises').setTimeout(5, 'v', { signal: ac.signal });
    ac.abort();
    return p;
  });
  require('node:fs').writeFileSync('pins-tmp.txt', 'abc');
  await pinAsync('fs.promises.readFile(f,{signal}) aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    return require('node:fs').promises.readFile('pins-tmp.txt', { signal: ac.signal });
  });
  await pinAsync(
    'fs.readFile(f,{signal}) aborted',
    () =>
      new Promise((res, rej) => {
        const ac = new AbortController();
        require('node:fs').readFile('pins-tmp.txt', { signal: ac.signal }, (e, d) =>
          e ? rej(e) : res(d.toString()),
        );
        ac.abort();
      }),
  );
  await pinAsync('fs.promises.readFile(f) no signal', () =>
    require('node:fs').promises.readFile('pins-tmp.txt', 'utf8'),
  );
  const stream = require('node:stream');
  pin('stream.addAbortSignal(undefined, readable)', () =>
    stream.addAbortSignal(undefined, new stream.Readable({ read() {} })),
  );
  pin('stream.addAbortSignal(sig, readable)', () =>
    stream.addAbortSignal(sig, new stream.Readable({ read() {} })),
  );
  await pinAsync('stream.pipeline with function stage', () =>
    require('node:stream/promises').pipeline(
      stream.Readable.from(['a', 'b']),
      async function* (src) {
        for await (const c of src) yield String(c).toUpperCase();
      },
      new stream.Writable({
        write(_c, _e, cb) {
          cb();
        },
      }),
    ),
  );
  require('node:fs').unlinkSync('pins-tmp.txt');
  process.stdout.write(`${lines.join('\n')}\n`);
}
main().catch((e) => {
  process.stdout.write(`${lines.join('\n')}\nFATAL\t${thrown(e)}\n`);
  process.exitCode = 1;
});
