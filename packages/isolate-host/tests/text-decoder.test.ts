import { execFileSync } from 'node:child_process';
/**
 * ADR-0577 acceptance (backlog `distribution/isolate-guest-textdecoder-legacy-encodings`): the
 * guest's `TextDecoder`/`TextEncoder` against live Node v24.16.0 (this process, and `node` over
 * the same files). utf-8 and the 33 encodings where Node equals WHATWG equal Node on the corpus
 * (`fixtures/text-decoder`); the five Node decodes by ICU's own tables (big5, euc-jp,
 * iso-2022-jp, shift_jis, euc-kr) refuse at construction with their named gap.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { GUEST_DIRS, MemoryFsSync, snapshotFs } from '../src/codec.ts';
import { createSandbox, runCode } from '../src/index.ts';
import { closureFiles, inNode, inSandbox } from './package-closure.ts';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const CASES = readFileSync(fixture('text-decoder/cases.cjs'), 'utf8');
const LABELS = (
  JSON.parse(readFileSync(fixture('text-decoder/encodings.json'), 'utf8')) as {
    encodings: { name: string; labels: string[] }[];
  }[]
).flatMap((g) => g.encodings.flatMap((e) => e.labels));
const ICU_ONLY = ['big5', 'euc-jp', 'iso-2022-jp', 'shift_jis', 'euc-kr'];
const ICU_ONLY_HINT =
  'decoded by ICU in Node; no source equals it in the rifty isolate host, ADR-0577';
const IN_SET = [
  'utf-8',
  'ibm866',
  'iso-8859-2',
  'iso-8859-3',
  'iso-8859-4',
  'iso-8859-5',
  'iso-8859-6',
  'iso-8859-7',
  'iso-8859-8',
  'iso-8859-8-i',
  'iso-8859-10',
  'iso-8859-13',
  'iso-8859-14',
  'iso-8859-15',
  'iso-8859-16',
  'koi8-r',
  'koi8-u',
  'macintosh',
  'windows-874',
  'windows-1250',
  'windows-1251',
  'windows-1252',
  'windows-1253',
  'windows-1254',
  'windows-1255',
  'windows-1256',
  'windows-1257',
  'windows-1258',
  'x-mac-cyrillic',
  'gbk',
  'gb18030',
  'utf-16be',
  'utf-16le',
  'x-user-defined',
];
const FNV = `const __fnv=(s)=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}return h.toString(16).padStart(8,'0')};`;
const BIG = { timeoutMs: 300_000, maxOutputBytes: 16 << 20, memoryLimitMb: 512 } as const;

type Corpus = {
  __runCases: (td: typeof TextDecoder, name: string) => string[];
  __fnv: (s: string) => string;
  __describeCase: (name: string, i: number) => unknown;
};
vm.runInThisContext(`${CASES}\n${FNV.replace('const __fnv', 'globalThis.__fnv')}`);
const corpus = globalThis as unknown as Corpus;

describe('isolate guest TextDecoder corpus vs Node v24.16.0', () => {
  it('runs on the pinned Node', () => {
    expect(process.version).toBe('v24.16.0');
    expect(LABELS).toHaveLength(228);
    expect(
      createHash('sha256')
        .update(readFileSync(fixture('text-decoder/encodings.json')))
        .digest('hex'),
    ).toBe('078212b3697f60b81225b6671bd9da2604497abff0aa8e96e4d46605c02ac9e7');
  });

  for (const name of IN_SET)
    it(
      `${name}: every corpus case equals Node (non-fatal and fatal)`,
      { timeout: 300_000 },
      async () => {
        const node = corpus.__runCases(TextDecoder, name).map(corpus.__fnv);
        const r = await runCode(
          `${CASES}\n${FNV}\nprocess.stdout.write(__runCases(TextDecoder, ${JSON.stringify(name)}).map(__fnv).join(''))`,
          BIG,
        );
        expect(r.stderr).toBe('');
        expect(r.exitCode).toBe(0);
        const guest = r.stdout.match(/.{8}/g) ?? [];
        const differ: unknown[] = [];
        for (let i = 0; i < node.length; i++)
          if (guest[i] !== node[i] && differ.length < 3)
            differ.push(corpus.__describeCase(name, i));
        expect({ cases: guest.length, differ }).toEqual({ cases: node.length, differ: [] });
      },
    );

  for (const name of ICU_ONLY)
    it(`${name}: every corpus case refused with the named gap`, { timeout: 300_000 }, async () => {
      const cases = corpus.__runCases(TextDecoder, name).length;
      const feature = `isolate-host.TextDecoder(${name})`;
      const r = await runCode(
        `${CASES}
let wrong = 0;
class TD { constructor(label, options) { try { return new TextDecoder(label, options); } catch (e) {
  if (!(e && e.name === 'NotImplementedError' && e.feature === ${JSON.stringify(feature)} && e.message === ${JSON.stringify(`Not implemented: ${feature} (${ICU_ONLY_HINT})`)})) wrong++; throw e; } } }
const tokens = __runCases(TD, ${JSON.stringify(name)});
process.stdout.write(JSON.stringify({ cases: tokens.length, refused: tokens.filter((t) => t === 'U\\u0001U').length, wrong }));`,
        BIG,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ cases, refused: cases, wrong: 0 });
    });
});

const STREAMS = readFileSync(fixture('text-decoder/stream-cases.cjs'), 'utf8');
vm.runInThisContext(STREAMS);
const streams = globalThis as unknown as {
  __runStreams: (td: typeof TextDecoder, name: string) => string[];
  __streamScenario: (
    name: string,
    i: number,
  ) => { fatal: boolean; chunks: number[][]; flush: boolean[] };
};
/**
 * Declared per encoding: scenarios that differ from Node, by kind (ADR-0577; compat ⚠️ for these
 * four). `afterError`: the decoder after one of its errors (ICU keeps the bytes at the error).
 * `fullTarget`: a call that does not flush and leaves bytes pending, its output exactly
 * `2 × min_char_size × length` — ICU stops on the full target and Node throws; the guest decodes.
 */
const STREAM_DECLARED: Readonly<Record<string, { afterError: number; fullTarget: number }>> = {
  gb18030: { afterError: 65, fullTarget: 0 },
  gbk: { afterError: 61, fullTarget: 0 },
  'utf-16le': { afterError: 60, fullTarget: 0 },
  'utf-16be': { afterError: 66, fullTarget: 0 },
};
const MIN_CHAR_SIZE: Readonly<Record<string, number>> = {
  gb18030: 1,
  gbk: 1,
  'utf-16le': 2,
  'utf-16be': 2,
};

describe('isolate guest TextDecoder over several stream calls vs Node v24.16.0', () => {
  for (const name of IN_SET)
    it(`${name}: equal to Node but the declared kinds`, { timeout: 120_000 }, async () => {
      const node = streams.__runStreams(TextDecoder, name);
      const r = await runCode(
        `${STREAMS}\nprocess.stdout.write(JSON.stringify(__runStreams(TextDecoder, ${JSON.stringify(name)})))`,
        BIG,
      );
      expect(r.stderr).toBe('');
      const guest = JSON.parse(r.stdout) as string[];
      expect(guest).toHaveLength(node.length);
      const kinds = { afterError: 0, fullTarget: 0 };
      const other: unknown[] = [];
      for (let i = 0; i < node.length; i++) {
        if (guest[i] === node[i]) continue;
        const a = (node[i] as string).split('\u0002');
        const b = (guest[i] as string).split('\u0002');
        let k = 0;
        while (a[k] === b[k]) k++;
        const s = streams.__streamScenario(name, i);
        const chunk = s.chunks[k] as number[];
        if (a.slice(0, k).some((t) => t.startsWith('E'))) kinds.afterError++;
        else if (
          a[k]?.startsWith('E') &&
          b[k]?.startsWith('S') &&
          !s.flush[k] &&
          (b[k] as string).length - 1 === 2 * (MIN_CHAR_SIZE[name] ?? 0) * chunk.length
        )
          kinds.fullTarget++;
        else if (other.length < 3) other.push({ scenario: s, node: a, guest: b });
      }
      expect(other).toEqual([]);
      expect(kinds).toEqual(STREAM_DECLARED[name] ?? { afterError: 0, fullTarget: 0 });
    });
});

/** One line per observation; an error is its class, code, message, `String`, own and enumerable keys. */
const PROBE = String.raw`(() => {
  const show = (v) => (typeof v === 'string' ? 'S:' + v : 'V:' + JSON.stringify(v));
  const d = (f) => { try { return show(f()); } catch (e) { return 'E:' + [e && e.constructor && e.constructor.name, e && e.code, e && e.message, String(e), Object.getOwnPropertyNames(e).join(','), Object.keys(e).join(','), e && e.feature, depth(e), typeof e.stack === 'string' && e.stack.split('\n')[0].endsWith(e.message)].join('|'); } };
  const depth = (e) => { let n = 0; for (let p = Object.getPrototypeOf(e); p && p !== Error.prototype; p = Object.getPrototypeOf(p)) n++; return n; };
  const util = require('util');
  const u8 = (...b) => new Uint8Array(b);
  const out = {};
  for (const l of LABELS) out['label ' + l] = d(() => new TextDecoder(l).encoding);
  Object.assign(out, {
    "nope": d(() => new TextDecoder('nope')),
    "replacement": d(() => new TextDecoder('replacement')),
    "csiso2022kr": d(() => new TextDecoder('csiso2022kr')),
    "' UTF-8 '": d(() => new TextDecoder(' UTF-8 ').encoding),
    "' utf-8'": d(() => new TextDecoder(' utf-8')),
    "label object": d(() => new TextDecoder({ toString: () => 'latin1' }).encoding),
    "options 1": d(() => new TextDecoder('utf-8', 1)),
    "options 'x'": d(() => new TextDecoder('utf-8', 'x')),
    "options null/[]/fn": d(() => [new TextDecoder('utf-8', null).fatal, new TextDecoder('utf-8', [1]).fatal, new TextDecoder('utf-8', () => {}).fatal]),
    "decode options 1": d(() => new TextDecoder().decode(u8(1), 1)),
    "utf-8 fatal ff": d(() => new TextDecoder('utf-8', { fatal: true }).decode(u8(0xff))),
    "utf-8 fatal stream": d(() => { const x = new TextDecoder('utf-8', { fatal: true }); x.decode(u8(0xe2), { stream: true }); return x.decode(u8(0x41)); }),
    "utf-16le fatal 00 d8": d(() => new TextDecoder('utf-16le', { fatal: true }).decode(u8(0, 0xd8))),
    "utf-16be fatal odd": d(() => new TextDecoder('utf-16be', { fatal: true }).decode(u8(0))),
    "gb18030 fatal 81": d(() => new TextDecoder('gb18030', { fatal: true }).decode(u8(0x81))),
    "gbk fatal 81": d(() => new TextDecoder('gbk', { fatal: true }).decode(u8(0x81))),
    "windows-1253 fatal aa": d(() => new TextDecoder('windows-1253', { fatal: true }).decode(u8(0xaa))),
    "iso-8859-6 fatal a1": d(() => new TextDecoder('iso-8859-6', { fatal: true }).decode(u8(0xa1))),
    "reuse after fatal": d(() => ['utf-8', 'utf-16le', 'gb18030', 'windows-1253'].map((enc) => { const x = new TextDecoder(enc, { fatal: true }); try { x.decode(u8(0xff, 0xd8, 0x81, 0xaa), { stream: true }); x.decode(); } catch {} return x.decode(u8(0x41, 0)); })),
    "decode('x')": d(() => new TextDecoder().decode('x')),
    "decode(1)": d(() => new TextDecoder().decode(1)),
    "decode(null)": d(() => new TextDecoder().decode(null)),
    "decode('x', stream)": d(() => new TextDecoder().decode('x', { stream: true })),
    "latin1 decode('x')": d(() => new TextDecoder('latin1').decode('x')),
    "utf-16le decode('x')": d(() => new TextDecoder('utf-16le').decode('x')),
    "inputs": d(() => ['utf-8', 'latin1', 'utf-16le', 'gb18030'].map((enc) => { const x = new TextDecoder(enc); const b = u8(0x68, 0, 0x69, 0, 0xe9, 0x80, 0xff, 0); return [x.decode(b.buffer), x.decode(new DataView(b.buffer, 2, 4)), x.decode(new Uint16Array(b.buffer, 2, 2)), x.decode(b.subarray(1, 5)), typeof SharedArrayBuffer === 'function' ? x.decode(new Uint8Array(new SharedArrayBuffer(2)).fill(0x41)) : 'no SAB', x.decode(), x.decode(undefined)]; })),
    "detached and out-of-bounds inputs": d(() => ['utf-8', 'latin1', 'utf-16le', 'gb18030'].map((enc) => { const x = new TextDecoder(enc); const b = new ArrayBuffer(8); const views = [new Uint8Array(b), new DataView(b), new Uint16Array(b, 2)]; b.transfer(); const r = new ArrayBuffer(8, { maxByteLength: 16 }); const oob = new Uint8Array(r, 4, 4); r.resize(2); return [x.decode(b), ...views.map((v) => x.decode(v)), x.decode(oob)]; })),
    "Uint8Array subclass members": d(() => { class V extends Uint8Array { get byteLength() { return 1; } get length() { return 1; } } return ['utf-8', 'utf-16le', 'gb18030', 'latin1'].map((enc) => new TextDecoder(enc).decode(new V([0x41, 0x42, 0x43, 0x44]))); }),
    "decode.call({})": d(() => TextDecoder.prototype.decode.call({})),
    "decode.call(null)": d(() => TextDecoder.prototype.decode.call(null)),
    "encoding getter on {}": d(() => Object.getOwnPropertyDescriptor(TextDecoder.prototype, 'encoding').get.call({})),
    "encode.call({})": d(() => TextEncoder.prototype.encode.call({})),
    "encoder encoding getter on {}": d(() => Object.getOwnPropertyDescriptor(TextEncoder.prototype, 'encoding').get.call({})),
    "getters": d(() => { const x = new TextDecoder('utf-16be', { fatal: 1, ignoreBOM: 'y' }); return [x.encoding, x.fatal, x.ignoreBOM]; }),
    "shape": d(() => [TextDecoder.name, TextDecoder.length, TextEncoder.length, Object.getOwnPropertyNames(TextDecoder.prototype), Object.keys(TextDecoder.prototype), Object.getOwnPropertyNames(TextEncoder.prototype), Object.keys(TextEncoder.prototype), TextDecoder.prototype.decode.length, TextEncoder.prototype.encodeInto.length, Object.getOwnPropertySymbols(new TextDecoder()).length, Object.getOwnPropertySymbols(new TextEncoder()).length]),
    "descriptors": d(() => [Object.getOwnPropertyDescriptor(globalThis, 'TextDecoder'), Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder')].map((x) => [typeof x.value, x.writable, x.enumerable, x.configurable])),
    "toString tag": d(() => Object.prototype.toString.call(new TextDecoder()) + Object.prototype.toString.call(new TextEncoder())),
    "inspect": d(() => [util.inspect(new TextDecoder()), util.inspect(new TextDecoder('latin1', { fatal: true })), util.inspect(new TextDecoder('utf-16be', { ignoreBOM: true })), util.inspect(new TextEncoder()), util.inspect(new TextDecoder(), { showHidden: true }), util.inspect({ d: new TextDecoder() }, { depth: -1 })]),
    "subclass": d(() => { class X extends TextDecoder {} const x = new X('latin1'); return [x.encoding, x.decode(u8(0xe9)), util.inspect(x)]; }),
    "util identities": d(() => [util.TextDecoder === TextDecoder, util.TextEncoder === TextEncoder]),
    "encodeInto non-u8 dest": d(() => new TextEncoder().encodeInto('a', {})),
    "encodeInto Uint16Array dest": d(() => new TextEncoder().encodeInto('a', new Uint16Array(2))),
    "encodeInto non-string src": d(() => new TextEncoder().encodeInto(1, new Uint8Array(4))),
    "encodeInto no dest": d(() => new TextEncoder().encodeInto('a')),
    "encodeInto ok": d(() => { const u = new Uint8Array(3); return [new TextEncoder().encodeInto('aé€', u), [...u]]; }),
    "encodeInto pair short": d(() => { const u = new Uint8Array(5); return [new TextEncoder().encodeInto('a😀b', u), [...u]]; }),
    "encode": d(() => [[...new TextEncoder().encode()], [...new TextEncoder().encode(undefined)], [...new TextEncoder().encode(null)], [...new TextEncoder().encode(12)], [...new TextEncoder().encode('\ud800')], [...new TextEncoder().encode('😀\udc00')]]),
    "encode result": d(() => { const r = new TextEncoder().encode('ab'); return [Object.getPrototypeOf(r) === Uint8Array.prototype, r.buffer.byteLength, r.byteOffset]; }),
    "Buffer#toString through the global": d(() => [Buffer.from([0xe2, 0x82, 0xac, 0xff]).toString(), Buffer.from([0xef, 0xbb, 0xbf, 0x41]).toString(), Buffer.from([0xe2, 0x82]).toString('utf8'), Buffer.from('hé').toString('latin1')]),
    "stream utf-8": d(() => { const x = new TextDecoder(); return [x.decode(u8(0xe2, 0x82), { stream: true }) + x.decode(u8(0xac)), x.decode(u8(0xef, 0xbb), { stream: true }) + x.decode(u8(0xbf, 0x41), { stream: true }) + x.decode(u8(0xef, 0xbb, 0xbf)) + x.decode(u8(0xf0), { stream: true }) + x.decode()]; }),
    "stream utf-16le": d(() => { const x = new TextDecoder('utf-16le'); return [x.decode(u8(0xff, 0xfe, 0x41), { stream: true }), x.decode(u8(0, 0x3d, 0xd8), { stream: true }), x.decode(u8(0, 0xde, 0x42)), x.decode(u8(0x41))]; }),
    "utf-8 stream: a BOM after a completed prefix": d(() => { const x = new TextDecoder(); return [x.decode(u8(0xc3), { stream: true }), x.decode(u8(0xa9, 0xef, 0xbb, 0xbf, 0x41), { stream: true })]; }),
    "gb18030/gbk stream: output past the binding's limit": d(() => ['gb18030', 'gbk'].map((enc) => { const x = new TextDecoder(enc); const r = [x.decode(u8(0x81, 0x30), { stream: true })]; try { r.push(x.decode(u8(0x41), { stream: true })); } catch (e) { r.push([e.constructor.name, e.code, e.message, String(e), Object.getOwnPropertyNames(e).join(',')].join('|')); } return r; })),
    "utf-16le fatal: the decoder after a mid-stream error": d(() => { const x = new TextDecoder('utf-16le', { fatal: true }); return [u8(0, 0xd8), u8(0x41, 0), u8(0x42, 0)].map((b) => { try { return x.decode(b, { stream: true }); } catch (e) { return 'E ' + e.code; } }); }),
    "gb18030 stream: a call that fills the output limit and leaves a byte pending": d(() => { const x = new TextDecoder('gb18030'); return [u8(0xa1, 0x30, 0x84), u8(0x18, 0xa1)].map((b) => { try { return x.decode(b, { stream: true }); } catch (e) { return 'E ' + e.code; } }); }),
    "constructors without new": d(() => [() => TextDecoder(), () => TextEncoder()].map((f) => { try { f(); } catch (e) { return e.constructor.name + ': ' + e.message; } })),
    "class and method names": d(() => [TextDecoder.name, TextEncoder.name, TextDecoder.prototype.decode.name, TextEncoder.prototype.encodeInto.name, Object.getOwnPropertyDescriptor(TextDecoder.prototype, 'encoding').get.name]),
    "class source text": d(() => [String(TextDecoder).slice(0, 48), String(TextEncoder.prototype.encode).slice(0, 24)]),
    "stream gb18030": d(() => { const x = new TextDecoder('gb18030'); return [x.decode(u8(0x81, 0x30), { stream: true }), x.decode(u8(0x81, 0x30, 0xb0), { stream: true }), x.decode(u8(0xa1)), x.decode(u8(0x81))]; }),
  });
  return out;
})()`;

function guestProbe(): string {
  return `const LABELS = ${JSON.stringify(LABELS)};\nprocess.stdout.write(JSON.stringify(${PROBE}));`;
}
const nodeProbe = (): Record<string, string> =>
  vm.runInThisContext(
    `((LABELS) => ${PROBE.replace("require('util')", "process.getBuiltinModule('util')")})(${JSON.stringify(LABELS)})`,
  ) as Record<string, string>;

/**
 * `util.inspect` honours no `util.inspect.custom` on any rifty host (`runtime-js/util-surface-completions`):
 * Node's `[inspect.custom]` of these classes is never called. Pinned until that item lands.
 */
/** Rows where the guest is not Node, each declared (ADR-0577 inventory, compat `isolate-host.md`): both sides. */
const DECLARED: Readonly<Record<string, { readonly node: string; readonly guest: string }>> = {
  // ICU keeps the bytes at a `fatal` error; the engine does not (compat ⚠️ utf-16/gb18030/gbk).
  'utf-16le fatal: the decoder after a mid-stream error': {
    node: 'V:["","E ERR_ENCODING_INVALID_ENCODED_DATA","䉁"]',
    guest: 'V:["","E ERR_ENCODING_INVALID_ENCODED_DATA","B"]',
  },
  // ICU stops on a full output buffer with bytes left (Node throws); the engine has no such buffer.
  'gb18030 stream: a call that fills the output limit and leaves a byte pending': {
    node: 'V:["","E ERR_ENCODING_INVALID_ENCODED_DATA"]',
    guest: 'V:["","�0�\\u0018"]',
  },
  // The guest bundle's source is esbuild-printed (every rifty builtin).
  'class source text': {
    node: 'V:["class TextDecoder {\\n  constructor(encoding = \'ut","encode(input = \'\') {\\n   "]',
    guest:
      'V:["class TextDecoder {\\n        constructor(encoding","encode(input2 = \\"\\") {\\n  "]',
  },
};
const INSPECT_GAP = {
  inspect:
    'V:["TextDecoder {}","TextDecoder {}","TextDecoder {}","TextEncoder {}","TextDecoder {}","[Object]"]',
  subclass: 'V:["windows-1252","é","X {}"]',
};

/** Node's observations, the five's labels as the guest's named gap, the inspect rows pinned. */
function expected(node: Record<string, string>): Record<string, string> {
  const out = { ...node };
  const gapOf = new Map<string, string>();
  for (const l of LABELS) {
    let enc = 'replacement';
    try {
      enc = new TextDecoder(l).encoding;
    } catch {}
    if (ICU_ONLY.includes(enc)) gapOf.set(l, enc);
  }
  for (const [label, enc] of gapOf) out[`label ${label}`] = `GAP isolate-host.TextDecoder(${enc})`;
  for (const [k, { node: n, guest: g }] of Object.entries(DECLARED)) {
    expect(node[k], `Node's side of the declared row ${k}`).toBe(n);
    out[k] = g;
  }
  return { ...out, ...INSPECT_GAP };
}
/** The guest's observations, its named-gap rows reduced to the gap (class + feature). */
function observed(guest: Record<string, string>): Record<string, string> {
  const out = { ...guest };
  for (const [k, v] of Object.entries(guest)) {
    const m =
      /^E:NotImplementedError\|.*\|(isolate-host\.TextDecoder\([a-z0-9_-]+\))\|1\|true$/.exec(v);
    if (k.startsWith('label ') && m) out[k] = `GAP ${m[1]}`;
  }
  return out;
}

describe('isolate guest TextDecoder labels, errors and identities vs Node v24.16.0', () => {
  it('runCode: 194 labels + 6 RangeError equal Node, 28 the named gap; every other row equal', async () => {
    const node = nodeProbe();
    const r = await runCode(guestProbe(), { maxOutputBytes: 4 << 20 });
    expect(r.stderr).toBe('');
    const guest = JSON.parse(r.stdout) as Record<string, string>;
    expect(observed(guest)).toEqual(expected(node));
    const labels = LABELS.map((l) => guest[`label ${l}`] as string);
    expect({
      accepted: labels.filter((v) => v.startsWith('S:')).length,
      rangeError: labels.filter((v) => v.startsWith('E:RangeError|ERR_ENCODING_NOT_SUPPORTED|'))
        .length,
      gap: labels.filter((v) => v.startsWith('E:NotImplementedError|')).length,
    }).toEqual({ accepted: 194, rangeError: 6, gap: 28 });
  });

  it('a file run (sandbox exec) observes the same', { timeout: 60_000 }, async () => {
    const fs = new MemoryFsSync();
    for (const dir of GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync('/workspace/probe.js', new TextEncoder().encode(guestProbe()));
    const sb = await createSandbox({
      snapshot: snapshotFs(fs, { template: null, maxBytes: 16 << 20 }),
    });
    try {
      const r = await sb.exec('probe.js', { maxOutputBytes: 4 << 20 });
      expect(r.stderr).toBe('');
      expect(observed(JSON.parse(r.stdout))).toEqual(expected(nodeProbe()));
    } finally {
      await sb.destroy();
    }
  });
});

/** Guest code replaced an intrinsic before its first decoder (each run its own isolate). */
describe('intrinsics a guest replaces before decoding', () => {
  const rows = {
    // The single-byte tables are built from `%TypedArray%.from` captured at load.
    'TypedArray.from replaced, then x-user-defined': {
      code: "Object.getPrototypeOf(Uint8Array).from = () => new Uint16Array(256); console.log(JSON.stringify(new TextDecoder('x-user-defined').decode(Uint8Array.of(0x41, 0x80, 0xff))));",
    },
    // Declared (`post-guest-paths-use-replaceable-intrinsics`): @exodus/bytes normalizes its label
    // with the live `String.prototype.trim`, so it can open another decoder than Node's.
    'String.prototype.trim replaced, then utf-16be': {
      code: "String.prototype.trim = () => 'utf-16le'; console.log(JSON.stringify(new TextDecoder('utf-16be').decode(Uint8Array.of(0, 0x41))));",
      node: '"A"\n',
      guest: '"䄀"\n',
    },
  } as const;
  for (const [name, row] of Object.entries(rows))
    it(name, { timeout: 60_000 }, async () => {
      const node = execFileSync(process.execPath, ['-e', row.code], { encoding: 'utf8' });
      const guest = await runCode(row.code);
      expect(guest.stderr).toBe('');
      if ('node' in row) {
        expect([node, guest.stdout]).toEqual([row.node, row.guest]);
      } else expect(guest.stdout).toBe(node);
    });
});

/** Paths over the guest's utf-16le decoder: `setEncoding` (parity `stream/readable-set-encoding-names`), `StringDecoder`, `Buffer#toString`. */
describe('utf-16le consumers in the guest vs node', () => {
  const caseSource = readFileSync(
    fileURLToPath(
      new URL(
        '../../../tools/node-parity-runner/cases/stream/readable-set-encoding-names.case.ts',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  const programs = {
    'readable-set-encoding-names': caseSource.slice(
      caseSource.indexOf('code: `') + 7,
      caseSource.lastIndexOf('`,'),
    ),
    'StringDecoder and Buffer#toString': `const { StringDecoder } = require('string_decoder');
for (const e of ['utf16le', 'ucs2', 'UTF-16LE']) { const d = new StringDecoder(e);
  console.log(e, JSON.stringify(d.write(Buffer.from([0x41, 0, 0x3d])) + d.write(Buffer.from([0xd8, 0, 0xde])) + d.end(Buffer.from([0x42])))); }
console.log(JSON.stringify(Buffer.from([0x41, 0, 0x3d, 0xd8, 0, 0xde, 0x42]).toString('utf16le')), JSON.stringify(Buffer.from([0xff, 0xfe, 0x41, 0]).toString('ucs2', 1)));`,
  };
  for (const [name, code] of Object.entries(programs))
    it(`${name}: stdout as node -e`, { timeout: 60_000 }, async () => {
      const node = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' });
      expect(node).toMatch(/utf16le/);
      expect(await runCode(code)).toEqual({ stdout: node, stderr: '', exitCode: 0 });
    });
});

// --- pdfkit 0.17.2 / fontkit 2.0.4 over their closure, `compress: false` (Acceptance 7, 12, 13) ---
const DEJAVU = readFileSync(fixture('fonts/DejaVuSans.ttf'));
/** Mac `name` records (nameID 1) in shift_jis, big5, euc-kr, gbk — what Apple's CJK fonts carry. */
const CJK: readonly [number, number, readonly number[]][] = [
  [1, 11, [0x83, 0x65, 0x83, 0x58, 0x83, 0x67]], // Japanese, shift_jis «テスト»
  [2, 19, [0xb4, 0xfa, 0xb8, 0xd5]], // Traditional Chinese, big5 «測試»
  [3, 23, [0xb0, 0xa1, 0xb3, 0xaa]], // Korean, euc-kr «가나»
  [25, 33, [0xb2, 0xe2, 0xca, 0xd4]], // Simplified Chinese, gbk «测试»
];
/** The font with those records added: an sfnt rebuild with a new `name` table. */
function withCjkNames(font: Buffer): Buffer {
  const tables: { tag: string; offset: number; length: number }[] = [];
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const o = 12 + i * 16;
    tables.push({
      tag: font.toString('latin1', o, o + 4),
      offset: font.readUInt32BE(o + 8),
      length: font.readUInt32BE(o + 12),
    });
  }
  const data = Object.fromEntries(
    tables.map((t) => [t.tag, font.subarray(t.offset, t.offset + t.length)]),
  );
  const name = data.name as Buffer;
  const storage = name.readUInt16BE(4);
  const records: { p: number; e: number; l: number; n: number; bytes: Buffer }[] = [];
  for (let i = 0; i < name.readUInt16BE(2); i++) {
    const o = 6 + i * 12;
    const at = storage + name.readUInt16BE(o + 10);
    records.push({
      p: name.readUInt16BE(o),
      e: name.readUInt16BE(o + 2),
      l: name.readUInt16BE(o + 4),
      n: name.readUInt16BE(o + 6),
      bytes: name.subarray(at, at + name.readUInt16BE(o + 8)),
    });
  }
  for (const [e, l, bytes] of CJK) records.push({ p: 1, e, l, n: 1, bytes: Buffer.from(bytes) });
  records.sort((a, b) => a.p - b.p || a.e - b.e || a.l - b.l || a.n - b.n);
  const header = Buffer.alloc(6 + records.length * 12);
  header.writeUInt16BE(records.length, 2);
  header.writeUInt16BE(header.length, 4);
  let at = 0;
  records.forEach((r, i) => {
    const o = 6 + i * 12;
    for (const [k, v] of [r.p, r.e, r.l, r.n, r.bytes.length, at].entries())
      header.writeUInt16BE(v, o + k * 2);
    at += r.bytes.length;
  });
  data.name = Buffer.concat([header, ...records.map((r) => r.bytes)]);
  const pad = (b: Buffer): Buffer => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const checksum = (b: Buffer): number => {
    let s = 0;
    const p = pad(b);
    for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0;
    return s;
  };
  const tags = tables.map((t) => t.tag).sort();
  const dir = Buffer.alloc(12 + tags.length * 16);
  font.copy(dir, 0, 0, 12);
  let off = dir.length;
  const bodies = tags.map((tag, i) => {
    const b = data[tag] as Buffer;
    const o = 12 + i * 16;
    dir.write(tag, o, 'latin1');
    dir.writeUInt32BE(checksum(b), o + 4);
    dir.writeUInt32BE(off, o + 8);
    dir.writeUInt32BE(b.length, o + 12);
    off += pad(b).length;
    return pad(b);
  });
  return Buffer.concat([dir, ...bodies]);
}

/** Records the labels fontkit constructs decoders for. */
const TRACE = `const __labels = new Set(); { const TD = globalThis.TextDecoder;
  globalThis.TextDecoder = class TextDecoder extends TD { constructor(l = 'utf-8', o) { __labels.add(String(l)); super(l, o); } }; }`;
const PDF = (font: string): string => `${TRACE}
const PDFDocument = require('pdfkit'); const fs = require('fs');
const doc = new PDFDocument({ compress: false, info: { CreationDate: new Date(0) } });
const chunks = []; doc.on('data', (c) => chunks.push(c));
doc.on('end', () => { fs.writeFileSync(process.argv[2], Buffer.concat(chunks)); console.log('labels', JSON.stringify([...__labels].sort()), 'bytes', Buffer.concat(chunks).length); });
doc.font(${font}).fontSize(14).text('Hello from pdfkit — é ü', 72, 72); doc.end();
`;
const CJK_NAMES = `const fontkit = require(require.resolve('fontkit', { paths: [require('path').dirname(require.resolve('pdfkit'))] }));
const fam = fontkit.openSync('fonts/DejaVuSans-cjk-names.ttf').name.records.fontFamily;
const show = (v) => (typeof v === 'string' ? v : 'BYTES ' + v.length);
console.log(JSON.stringify(Object.fromEntries(Object.keys(fam).sort().map((k) => [k, show(fam[k])]))));
`;
let pdfFiles: Map<string, Uint8Array> | undefined;
function pdfkitFiles(): Map<string, Uint8Array> {
  if (pdfFiles) return pdfFiles;
  const host = fileURLToPath(new URL('..', import.meta.url));
  const dir = execFileSync(
    process.execPath,
    ['-p', "require('path').dirname(require.resolve('pdfkit/package.json'))"],
    { cwd: host, encoding: 'utf8' },
  ).trim();
  const files = closureFiles('pdfkit', dir);
  files.set('fonts/DejaVuSans.ttf', DEJAVU);
  files.set('fonts/DejaVuSans-cjk-names.ttf', withCjkNames(DEJAVU));
  const programs = {
    'helvetica.js': PDF("'Helvetica'"),
    'ttf.js': PDF("'fonts/DejaVuSans.ttf'"),
    'cjk-pdf.js': PDF("'fonts/DejaVuSans-cjk-names.ttf'"),
    'cjk-names.js': CJK_NAMES,
  };
  for (const [name, src] of Object.entries(programs))
    files.set(name, new TextEncoder().encode(src));
  pdfFiles = files;
  return files;
}
const sha = (b: Uint8Array | undefined): string | undefined =>
  b && createHash('sha256').update(b).digest('hex');
const outcome = (o: { stdout: string; exitCode: number | null; file?: Uint8Array }) => ({
  stdout: o.stdout,
  exitCode: o.exitCode,
  pdf: sha(o.file),
});

describe('pdfkit 0.17.2 / fontkit in the sandbox vs node', () => {
  for (const [program, labels] of [
    ['helvetica.js', '["ascii"]'],
    ['ttf.js', '["ascii","utf-16be","x-mac-roman"]'],
  ] as const)
    it(
      `${program}: Node's out.pdf bytes; fontkit asks ${labels}`,
      { timeout: 120_000 },
      async () => {
        const files = pdfkitFiles();
        const node = inNode(files, program, 'out.pdf');
        expect(node.stdout).toContain(`labels ${labels}`);
        expect(outcome(await inSandbox(files, program, 'out.pdf'))).toEqual(outcome(node));
      },
    );

  // Declared ⚠️ (compat isolate-host.md): fontkit's restructure catches the five's gap, so a CJK
  // Mac `name` record reads as its bytes, silently; the PDF bytes stay Node's.
  it(
    "CJK name records: PDF bytes Node's; the five's names are fontkit's raw bytes",
    { timeout: 120_000 },
    async () => {
      const files = pdfkitFiles();
      const node = inNode(files, 'cjk-pdf.js', 'out.pdf');
      expect(node.stdout).toContain(
        'labels ["ascii","big5","euc-kr","gbk","shift-jis","utf-16be","x-mac-roman"]',
      );
      expect(outcome(await inSandbox(files, 'cjk-pdf.js', 'out.pdf'))).toEqual(outcome(node));
      const nodeNames = inNode(files, 'cjk-names.js', 'out.pdf');
      expect(JSON.parse(nodeNames.stdout)).toEqual({
        en: 'DejaVu Sans',
        ja: 'テスト',
        ko: '가나',
        zh: '测试',
        'zh-Hant': '測試',
      });
      const names = await inSandbox(files, 'cjk-names.js', 'out.pdf');
      expect([names.exitCode, JSON.parse(names.stdout)]).toEqual([
        0,
        { en: 'DejaVu Sans', ja: 'BYTES 6', ko: 'BYTES 4', zh: '测试', 'zh-Hant': 'BYTES 4' },
      ]);
    },
  );
});
