import type { ParityCase } from '../../src/types.ts';

// node:string_decoder over every encoding name normalizeEncoding maps: each input
// fed in every chunk size 1..N and every 2-way cut; per write the text and
// lastNeed/lastTotal/lastChar, then end() and reuse. Plus argument errors.
const c: ParityCase = {
  code: `
    const { StringDecoder } = require('node:string_decoder');
    const { Buffer } = require('node:buffer');
    const cps = (s) => [...s].map((ch) => ch.codePointAt(0).toString(16)).join('.') || '-';
    const units = (s) => Array.from(s, (ch) => [...Array(ch.length).keys()].map((i) => ch.charCodeAt(i).toString(16)).join('+')).join('.') || '-';
    const st = (d) => d.lastNeed + '/' + d.lastTotal + '/' + Buffer.from(d.lastChar).toString('hex');
    const err = (e) => (e && e.name) + ':' + (e && e.code) + ':' + (e && e.message);
    const tryit = (f) => { try { return f(); } catch (e) { return 'threw ' + err(e); } };

    const SPELLINGS = ['utf8', 'UTF8', 'utf-8', 'UTF-8', 'Utf8', 'uTf-8', 'ucs2', 'UCS2', 'ucs-2', 'UCS-2', 'Ucs2',
      'utf16le', 'UTF16LE', 'utf-16le', 'UTF-16LE', 'Utf16Le', 'latin1', 'LATIN1', 'Latin1', 'binary', 'BINARY', 'Binary',
      'base64', 'BASE64', 'Base64', 'base64url', 'BASE64URL', 'Base64Url', 'hex', 'HEX', 'Hex', 'ascii', 'ASCII', 'Ascii',
      '', undefined, null];
    const BYTES = [0x41, 0xe2, 0x82, 0xac, 0x00, 0xd8, 0x3d, 0xd8, 0x00, 0xde, 0xff, 0x7f, 0x80];
    for (const n of SPELLINGS) {
      console.log('name', JSON.stringify(n), tryit(() => {
        const d = new StringDecoder(n);
        const a = d.write(Buffer.from(BYTES.slice(0, 3)));
        return d.encoding + ' ' + units(a) + ' ' + units(d.end(Buffer.from(BYTES.slice(3)))) + ' ' + st(d);
      }));
    }
    for (const n of ['nope', 'utf-16be', 'utf16', 'utf-16', 'buffer', 'latin-1', 'base-64', 'utf 8', ' utf8', '__proto__',
      'constructor', 'toString', 'hasOwnProperty', 'utf8\\u0000']) {
      console.log('bad', JSON.stringify(n), tryit(() => new StringDecoder(n).encoding));
    }
    for (const [label, v] of [['1', 1], ['0', 0], ['true', true], ['obj', {}], ['arr', ['utf8']], ['strobj', new String('hex')],
      ['toString-obj', { toString() { return 'hex'; } }], ['sym', Symbol('x')], ['fn', function f() {}]]) {
      console.log('arg', label, tryit(() => new StringDecoder(v).encoding));
    }

    const INPUTS = {
      utf8: [
        ['ascii', [0x61, 0x62, 0x63]],
        ['mixed', [0x41, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0x42]],
        ['bom', [0xef, 0xbb, 0xbf, 0x41]],
        ['trunc3', [0x41, 0xe2, 0x82]],
        ['trunc4', [0x41, 0xf0, 0x9f, 0x98]],
        ['bad-cont', [0xe2, 0x82, 0x41, 0xf0, 0x9f, 0x42]],
        ['overlong', [0xc0, 0xaf, 0xe0, 0x80, 0xaf, 0x41]],
        ['surrogate', [0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80]],
        ['lead-f5', [0xf5, 0x80, 0x80, 0x80, 0x41]],
        ['lead-f8', [0x41, 0xf8, 0x88, 0x80]],
        ['conts', [0x80, 0x80, 0x80, 0x80, 0x80]],
        ['tail-conts', [0x41, 0xbf, 0xbf]],
        ['extra-cont', [0xc3, 0xa9, 0xa9, 0x41]],
        ['ff', [0xff, 0xfe, 0x41]],
        ['two-leads', [0xe2, 0xe2, 0x82, 0xac]],
      ],
      utf16le: [
        ['plain', [0x41, 0x00, 0x42, 0x00]],
        ['pair', [0x41, 0x00, 0x3d, 0xd8, 0x00, 0xde, 0x42, 0x00]],
        ['lone-high', [0x00, 0xd8, 0x41, 0x00]],
        ['lone-low', [0x00, 0xdc, 0x41, 0x00]],
        ['high-end', [0x41, 0x00, 0x3d, 0xd8]],
        ['odd-tail', [0x41, 0x00, 0x42]],
        ['high-high', [0x00, 0xd8, 0x00, 0xd8, 0x00, 0xdc]],
        ['bom', [0xff, 0xfe, 0x41, 0x00]],
      ],
      latin1: [['bytes', [0x00, 0x41, 0x7f, 0x80, 0xe9, 0xff]]],
      ascii: [['bytes', [0x00, 0x41, 0x7f, 0x80, 0xe9, 0xff]]],
      base64: [
        ['len1', [0x61]], ['len2', [0x61, 0x62]], ['len4', [0x61, 0x62, 0x63, 0x64]],
        ['len7', [0xfb, 0xff, 0xfe, 0x00, 0x3e, 0x3f, 0x41]],
      ],
      base64url: [['len5', [0xfb, 0xff, 0xfe, 0x3e, 0x3f]], ['len7', [0xfb, 0xff, 0xfe, 0x00, 0x3e, 0x3f, 0x41]]],
      hex: [['odd', [0x00, 0x0f, 0xab]], ['even', [0xff, 0x10, 0x01, 0xa0]]],
    };
    const run = (enc, chunks) => {
      const d = new StringDecoder(enc);
      const parts = chunks.map((c) => units(d.write(Buffer.from(c))) + '@' + st(d));
      parts.push('end ' + units(d.end()) + '@' + st(d));
      return parts.join(' | ');
    };
    for (const [enc, list] of Object.entries(INPUTS)) {
      for (const [label, bytes] of list) {
        for (let k = 1; k <= bytes.length; k++) {
          const chunks = [];
          for (let i = 0; i < bytes.length; i += k) chunks.push(bytes.slice(i, i + k));
          console.log(enc, label, 'size' + k, tryit(() => run(enc, chunks)));
        }
        for (let cut = 1; cut < bytes.length; cut++) {
          console.log(enc, label, 'cut' + cut, tryit(() => run(enc, [bytes.slice(0, cut), bytes.slice(cut)])));
        }
        console.log(enc, label, 'end(buf)', tryit(() => {
          const d = new StringDecoder(enc);
          const head = units(d.write(Buffer.from(bytes.slice(0, bytes.length - 1))));
          const tail = units(d.end(Buffer.from(bytes.slice(bytes.length - 1))));
          return head + ' ' + tail + ' reuse ' + units(d.write(Buffer.from(bytes))) + ' ' + units(d.end()) + '@' + st(d);
        }));
      }
    }

    // argument kinds through write/end/text
    const d = new StringDecoder('utf8');
    const ab = new Uint8Array([0x41, 0xe2, 0x82, 0xac, 0x42]).buffer;
    console.log('write str', tryit(() => d.write('héllo') + ' ' + st(d)));
    console.log('write empty', tryit(() => JSON.stringify(d.write(Buffer.alloc(0))) + ' ' + st(d)));
    console.log('write u8', tryit(() => units(d.write(new Uint8Array(ab, 0, 3))) + ' ' + st(d)));
    console.log('write dataview', tryit(() => units(d.write(new DataView(ab, 3, 2))) + ' ' + st(d)));
    console.log('write u16', tryit(() => units(new StringDecoder('utf16le').write(new Uint16Array([0x41, 0xd83d, 0xde00])))));
    console.log('write f64', tryit(() => units(new StringDecoder('hex').write(new Float64Array([1.5])))));
    for (const [label, v] of [['undefined', undefined], ['null', null], ['num', 123], ['arr', [65]], ['ab', ab], ['obj', {}],
      ['bigint', 5n], ['bool', false]]) {
      console.log('write', label, tryit(() => new StringDecoder('utf8').write(v)));
    }
    console.log('end str', tryit(() => { const x = new StringDecoder('utf8'); x.write(Buffer.from([0xe2])); return units(x.end('zz')); }));
    console.log('end num', tryit(() => new StringDecoder('utf8').end(1)));
    console.log('end null', tryit(() => new StringDecoder('utf8').end(null)));
    console.log('text', tryit(() => { const x = new StringDecoder('utf8'); x.write(Buffer.from([0xe2, 0x82])); return units(x.text(Buffer.from([0x41, 0x42, 0xe2, 0x82, 0xac, 0xe2]), 2)) + '@' + st(x); }));
    console.log('text u8', tryit(() => units(new StringDecoder('base64').text(new Uint8Array([1, 2, 3, 4]), 1))));

    // state accessors and shape
    console.log('lastChar', tryit(() => {
      const s = new StringDecoder('utf16le');
      s.write(Buffer.from([0x3d, 0xd8, 0x00]));
      const lc = s.lastChar;
      const shape = [Buffer.isBuffer(lc), lc.length, lc.constructor.name, lc === s.lastChar, lc.buffer === s.lastChar.buffer].join(' ');
      s.end();
      return shape + ' after end ' + lc.toString('hex') + ' ' + st(s);
    }));
    console.log('own keys', tryit(() => Object.keys(new StringDecoder('hex')).join(',')));
    console.log('proto keys', Object.keys(StringDecoder.prototype).join(','));
    console.log('descriptors', ['lastChar', 'lastNeed', 'lastTotal'].map((k) => {
      const p = Object.getOwnPropertyDescriptor(StringDecoder.prototype, k);
      return k + ':' + (p ? typeof p.get + typeof p.set + p.enumerable + p.configurable : 'none');
    }).join(' '));
    console.log('fn', typeof StringDecoder, StringDecoder.name, StringDecoder.length, ...['write', 'end', 'text'].map((k) => typeof StringDecoder.prototype[k] === 'function' ? StringDecoder.prototype[k].length : 'none'));
    console.log('no new', tryit(() => StringDecoder('utf8')));
    console.log('foreign this write', tryit(() => StringDecoder.prototype.write.call({}, Buffer.from('a'))));
    console.log('foreign this write str', tryit(() => StringDecoder.prototype.write.call({}, 'a')));
    console.log('foreign this lastNeed', tryit(() => Object.getOwnPropertyDescriptor(StringDecoder.prototype, 'lastNeed').get.call({})));
    function Legacy(enc) { StringDecoder.call(this, enc); }
    Legacy.prototype = Object.create(StringDecoder.prototype);
    console.log('legacy', tryit(() => {
      const leg = new Legacy('base64');
      return [leg.encoding, leg.write(Buffer.from([0x61])), leg.end(), leg instanceof StringDecoder].join(' ');
    }));

    // the view's own bytes are read, never its overridable members (Node: ArrayBufferViewContents)
    const view = (label, enc, make) => console.log('view', label, tryit(() => {
      const d = new StringDecoder(enc);
      return units(d.write(make())) + ' ' + units(d.end(make())) + '@' + st(d);
    }));
    view('own subarray/slice', 'utf8', () => { const b = Buffer.from([0x41, 0xe2, 0x82]); b.subarray = () => Buffer.from('Z'); b.slice = () => Buffer.from('Y'); return b; });
    view('own length', 'base64', () => { const b = Buffer.from('ABCDE'); Object.defineProperty(b, 'length', { value: 1 }); return b; });
    view('own buffer/byteOffset', 'hex', () => { const u = new Uint8Array([0x41, 0x42]); Object.defineProperty(u, 'buffer', { value: new Uint8Array([0x5a]).buffer }); Object.defineProperty(u, 'byteOffset', { value: 1 }); return u; });
    view('dataview own byteLength/buffer', 'utf16le', () => { const dv = new DataView(new Uint8Array([0x41, 0x00, 0x3d]).buffer); Object.defineProperty(dv, 'byteLength', { value: 1 }); Object.defineProperty(dv, 'buffer', { value: new ArrayBuffer(0) }); return dv; });
    class Sub extends Uint8Array {
      get length() { return 1; }
      subarray() { return new Uint8Array([0x5a]); }
      slice() { return new Uint8Array([0x59]); }
      at() { return 0x58; }
    }
    view('subclass', 'utf8', () => new Sub([0x41, 0xc3, 0xa9, 0xe2]));
    const proto = Object.create(Buffer.prototype, { length: { get() { return 2; } }, subarray: { value() { return Buffer.from('Z'); } } });
    view('buffer proto override', 'latin1', () => Object.setPrototypeOf(Buffer.from([0x41, 0xe9, 0xff]), proto));
    console.log('view patched TypedArray.prototype', tryit(() => {
      const TA = Object.getPrototypeOf(Uint8Array.prototype);
      const saved = ['subarray', 'set', 'slice'].map((k) => [k, TA[k]]);
      TA.subarray = function () { return new Uint8Array([0x5a]); };
      TA.set = function () {};
      TA.slice = function () { return new Uint8Array([0x59]); };
      try {
        const d = new StringDecoder('utf8');
        const a = d.write(Buffer.from([0x41, 0xf0, 0x9f])) + '|' + d.write(Buffer.from([0x98, 0x80, 0x42]));
        return units(a) + ' ' + units(d.end(Buffer.from([0xe2]))) + '@' + d.lastNeed + '/' + d.lastTotal;
      } finally {
        for (const [k, v] of saved) TA[k] = v;
      }
    }));
    // detached and out-of-bounds views read as empty (Node: no throw)
    const detached = (make) => { const ab = new ArrayBuffer(4); new Uint8Array(ab).set([0x41, 0xe2, 0x82, 0xac]); const v = make(ab); ab.transfer(); return v; };
    const resized = (make, to) => { const ab = new ArrayBuffer(8, { maxByteLength: 16 }); new Uint8Array(ab).set([0x41, 0x42, 0xe2, 0x82, 0xac, 0x43, 0x44, 0x45]); const v = make(ab); ab.resize(to); return v; };
    for (const [label, make] of [
      ['detached Uint8Array', () => detached((ab) => new Uint8Array(ab))],
      ['detached Buffer', () => detached((ab) => Buffer.from(ab))],
      ['detached Uint16Array', () => detached((ab) => new Uint16Array(ab))],
      ['detached DataView', () => detached((ab) => new DataView(ab))],
      ['oob Uint8Array', () => resized((ab) => new Uint8Array(ab, 4, 4), 2)],
      ['oob DataView', () => resized((ab) => new DataView(ab, 4, 4), 2)],
      ['tracking Uint8Array', () => resized((ab) => new Uint8Array(ab, 1), 4)],
      ['tracking DataView', () => resized((ab) => new DataView(ab, 1), 4)],
    ]) {
      for (const enc of ['utf8', 'hex', 'base64', 'utf16le']) {
        console.log('view', label, enc, tryit(() => {
          const d = new StringDecoder(enc);
          const a = units(d.write(Buffer.from([0xe2]))) + ' ' + units(d.write(make())) + '@' + st(d);
          return a + ' ' + units(d.end(make())) + '@' + st(d);
        }));
      }
    }
    // guest-replaced intrinsics do not reach the decoder (Node: primordials / native)
    const intrinsics = [
      ['Array.prototype.indexOf', Array.prototype, 'indexOf', () => -1],
      ['String.prototype.toLowerCase', String.prototype, 'toLowerCase', () => 'nope'],
      ['Math.min', Math, 'min', () => 0],
      ['Object.assign', Object, 'assign', () => ({})],
      ['Function.prototype.call', Function.prototype, 'call', () => 'P'],
    ];
    for (const [label, target, key, fake] of intrinsics) {
      const inputs = [Buffer.from('hi'), Buffer.from([0xe2, 0x82]), Buffer.from([0xac, 0x41])];
      const saved = target[key];
      let out;
      target[key] = fake;
      try {
        const a = new StringDecoder('UTF-8');
        const b = new StringDecoder('Hex');
        out = [a.write(inputs[0]), a.write(inputs[1]), a.write(inputs[2]), a.end(), a.lastNeed, b.write(inputs[0]), b.encoding];
        try { StringDecoder.prototype.write.call({}, inputs[0]); } catch (e) { out.push(e.code + ':' + e.message); }
      } catch (e) {
        out = ['threw', e.name, e.code, e.message];
      } finally {
        target[key] = saved;
      }
      console.log('patched', label, out.map(String).join(' '));
    }
    console.log('patched Buffer.isEncoding', tryit(() => {
      const saved = Buffer.isEncoding;
      Buffer.isEncoding = () => true;
      try { return new StringDecoder('foo').encoding; } finally { Buffer.isEncoding = saved; }
    }));
    for (const [label, f] of [['returns', () => 'P'], ['throws', () => { throw new Error('format'); }]]) {
      console.log('patched util.format', label, tryit(() => {
        const util = require('node:util');
        const saved = util.format;
        util.format = f;
        try { return new StringDecoder({}).encoding; } finally { util.format = saved; }
      }));
    }
  `,
};

export default c;
