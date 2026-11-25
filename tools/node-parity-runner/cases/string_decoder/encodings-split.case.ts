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
  `,
};

export default c;
