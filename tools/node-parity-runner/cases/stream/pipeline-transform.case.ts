import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Readable, Writable, Transform, pipeline } = require('node:stream');
    const upper = new Transform({
      transform(chunk, _enc, cb) { cb(null, String(chunk).toUpperCase()); },
    });
    const out = [];
    const sink = new Writable({
      write(chunk, _enc, cb) { out.push(String(chunk)); cb(); },
    });
    pipeline(Readable.from(['hi', 'there']), upper, sink, (err) => {
      if (err) console.log('err: ' + err.message);
      else console.log(out.join('|'));
    });
  `,
};

export default c;
