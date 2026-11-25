import type { ParityCase } from '../../src/types.ts';

// `Readable#setEncoding(name)` resolves names as `new StringDecoder(name)`: every
// normalizeEncoding spelling, ''/null/undefined → utf8, prototype keys and
// non-strings → ERR_UNKNOWN_ENCODING; one whole chunk decodes under the name.
const c: ParityCase = {
  code: `
    const { Readable, Duplex, Transform } = require('node:stream');
    const { Buffer } = require('node:buffer');
    const err = (e) => e.name + ':' + e.code + ':' + e.message;
    const NAMES = ['utf8', 'UTF-8', 'Utf8', 'ucs2', 'UCS-2', 'utf16le', 'UTF-16LE', 'latin1', 'Binary', 'BASE64',
      'base64url', 'Hex', 'ASCII', '', null, undefined, '__proto__', 'constructor', 'toString', 'hasOwnProperty',
      'nope', 'buffer', 'utf-16be', 1, -0, 5n, {}, ['hex'], new String('hex'), Symbol('s')];
    const bytes = Buffer.from([0x41, 0xc3, 0xa9, 0x00, 0xff, 0x42]); // 3n bytes: no base64 carry (decoder mechanism, not names)
    (async () => {
      for (const n of NAMES) {
        const label = typeof n === 'symbol' ? n.toString() : typeof n === 'bigint' ? n + 'n' : JSON.stringify(n);
        const r = new Readable({ read() {} });
        let line;
        try {
          const ret = r.setEncoding(n);
          line = 'this=' + (ret === r) + ' enc=' + r.readableEncoding;
        } catch (e) {
          console.log(label, 'threw', err(e), 'enc=' + r.readableEncoding);
          continue;
        }
        const chunks = [];
        r.on('data', (c) => chunks.push(typeof c + ':' + Buffer.from(c, 'latin1').toString('hex')));
        await new Promise((res) => { r.on('end', res); r.push(bytes); r.push(null); });
        console.log(label, line, chunks.join(' '));
      }
      for (const [k, C] of [['Readable', Readable], ['Duplex', Duplex], ['Transform', Transform]]) {
        for (const enc of ['nope', '__proto__']) {
          try { new C({ encoding: enc }); console.log(k, enc, 'ok'); } catch (e) { console.log(k, enc, 'threw', err(e)); }
        }
      }
    })();
  `,
};

export default c;
