import type { ParityCase } from '../../src/types.ts';

// node:string_decoder keeps a leading BOM: whole, split across writes, through
// end(buf), after a reset by end(), and via the legacy StringDecoder.call idiom.
const c: ParityCase = {
  code: `
    const { StringDecoder } = require('node:string_decoder');
    const { Buffer } = require('node:buffer');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    const bom = [0xef, 0xbb, 0xbf, 0x41];
    const whole = new StringDecoder('utf8');
    console.log('whole', cps(whole.write(Buffer.from(bom)) + whole.end()));
    const split = new StringDecoder('utf8');
    console.log('split', cps(split.write(Buffer.from([0xef])) + split.write(Buffer.from([0xbb])) + split.write(Buffer.from([0xbf, 0x41])) + split.end()));
    const ended = new StringDecoder('utf8');
    console.log('end-buf', cps(ended.end(Buffer.from(bom))));
    console.log('after-end', cps(ended.write(Buffer.from(bom)) + ended.end()));
    function Legacy() { StringDecoder.call(this, 'utf8'); }
    Legacy.prototype.write = StringDecoder.prototype.write;
    Legacy.prototype.end = StringDecoder.prototype.end;
    const legacy = new Legacy();
    console.log('legacy', cps(legacy.write(Buffer.from(bom)) + legacy.end()));
  `,
};

export default c;
