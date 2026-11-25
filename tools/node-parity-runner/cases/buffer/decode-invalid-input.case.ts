/**
 * base64 / base64url / hex decoding of input outside the alphabet, as Node's
 * native decoders do it: base64 takes both alphabets, skips other characters,
 * stops at '='; hex stops at the first bad pair and drops an odd tail; a two-byte
 * character counts by its low byte. `byteLength` is Node's estimate, not the
 * decoded size; a fill that decodes to nothing throws ERR_INVALID_ARG_VALUE.
 * A seeded fuzz and a >4096-char input (Node's unpooled path) cover the rest.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Buffer } = require('node:buffer');
    const label = (e) =>
      'threw ' + (e && e.name) + (e && e.code !== undefined ? ' ' + e.code : '') + ': ' + (e && e.message);
    const run = (f) => {
      try {
        const v = f();
        return v instanceof Uint8Array ? 'bytes ' + Buffer.from(v).toString('hex') : JSON.stringify(v);
      } catch (e) {
        return label(e);
      }
    };
    const B64 = [
      '', 'A', 'AA', 'AAA', 'AAAA', 'AAAAA', 'QQ', 'QQ=', 'QQ==', 'QQ===', 'QUI', 'QUI=', 'QUJD',
      'QUJDRA', 'QUJDRA==', 'QUJDRA=', 'QUJDRA=x', 'QUJDRA==x', 'QUJDR', 'QUJDRAB',
      'Q Q==', ' QUJD ', 'QU\\nJD', 'QU\\tJD\\r\\n', 'QU\\vJD', 'QU\\fJD', 'QQ= =',
      'QQ==QUI=', 'QQ=QUI', '=QUJD', 'Q=Q=', 'Zm9v=YmFy', 'Zm9v YmFy', 'Zm9v\\nYmFy\\n',
      'a-b', 'a_b', 'a+b', 'a/b', '-_8', 'ab-_+/', '-_-_', '+/+/',
      'A\\u00e9', '\\u00e9A', 'QUJD\\u00e9', 'QU*JD', 'QU.JD', 'QUJD!', '!!!!', 'QUJD\\u0000',
      'QUJD\\u00ff', 'QUJD\\u0100', 'QUJD\\ud83d\\ude00', '\\u0141UJD', 'QUJ\\u0144', 'QQ\\u013dQUI',
    ];
    const HEX = [
      '', 'a', 'ab', 'abc', 'abcd', 'AB', 'aBcD', 'zz', 'az', 'za', 'abzz', 'zzab', 'ab zz', 'ab cd',
      ' abcd', 'abcd ', 'a b', '0x12', 'A\\u00e9', '\\u00e91', 'ab\\u00e91', 'ab12g3', '1g', 'g1',
      '12345', '\\u0661\\u0662', '\\u0161b', 'abcdef0123456789ABCDEF', 'ab\\ncd', '+1', '-1', 'ab+1',
    ];
    const rows = (enc, s) => [
      ['from', () => Buffer.from(s, enc)],
      ['byteLength', () => Buffer.byteLength(s, enc)],
      ['write', () => { const b = Buffer.alloc(8, 0xee); return [b.write(s, enc), b.toString('hex')]; }],
      ['write len 2', () => { const b = Buffer.alloc(8, 0xee); return [b.write(s, 1, 2, enc), b.toString('hex')]; }],
      ['fill', () => Buffer.alloc(4).fill(s, enc)],
      ['alloc', () => Buffer.alloc(4, s, enc)],
      ['indexOf', () => Buffer.from('xQQyAB').indexOf(s, enc)],
      ['lastIndexOf', () => Buffer.from('xQQyAB').lastIndexOf(s, enc)],
    ];
    for (const enc of ['base64', 'base64url']) for (const s of B64)
      for (const [k, f] of rows(enc, s)) console.log(enc, JSON.stringify(s), k, run(f));
    for (const s of HEX)
      for (const [k, f] of rows('hex', s)) console.log('hex', JSON.stringify(s), k, run(f));

    // Seeded fuzz over both alphabets, separators, '=', non-ASCII and low-byte aliases.
    let seed = 0x2545f491;
    const rnd = (n) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const pick = (alphabet, max) => {
      let s = '';
      const len = rnd(max + 1);
      for (let i = 0; i < len; i++) s += alphabet[rnd(alphabet.length)];
      return s;
    };
    const B64_ALPHABET = Array.from('AQUJDRZm9v+/-_=  \\n\\t!.\\u00e9').concat(['\\u013d', '\\u0141', '\\u0100']);
    const HEX_ALPHABET = Array.from('0123456789abcdefABCDEFgz \\u00e9').concat(['\\u0661', '\\u0130']);
    for (const enc of ['base64', 'base64url']) {
      const out = [];
      for (let i = 0; i < 400; i++) {
        const s = pick(B64_ALPHABET, 14);
        out.push(Buffer.from(s, enc).toString('hex') + '/' + Buffer.byteLength(s, enc));
      }
      console.log(enc, 'fuzz', out.join(' '));
    }
    const hexOut = [];
    for (let i = 0; i < 400; i++) {
      const s = pick(HEX_ALPHABET, 10);
      hexOut.push(Buffer.from(s, 'hex').toString('hex') + '/' + Buffer.byteLength(s, 'hex'));
    }
    console.log('hex fuzz', hexOut.join(' '));

    // Past Buffer.poolSize >>> 1 characters Node sizes the buffer by byteLength.
    const sum = (b) => b.reduce((a, x) => (a * 31 + x) >>> 0, 7);
    for (const s of [
      'QUJD'.repeat(1500) + '\\u00e9' + 'QQ',
      'QUJD'.repeat(1500) + '\\u0100' + 'QQ',
      'QUJD'.repeat(1500) + '=' + 'QUJD',
      'QUJD-_'.repeat(1000),
      ' QUJD\\n'.repeat(1000),
    ]) {
      for (const enc of ['base64', 'base64url']) {
        const b = Buffer.from(s, enc);
        console.log('large', enc, s.length, b.length, sum(b), Buffer.byteLength(s, enc));
      }
    }
    const big = 'ab'.repeat(3000) + 'zz' + 'cd'.repeat(10);
    console.log('large hex', Buffer.from(big, 'hex').length, Buffer.byteLength(big, 'hex'));
  `,
};

export default c;
