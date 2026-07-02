import type { ParityCase } from '../../src/types.ts';

/**
 * `Readable.prototype.wrap(legacyStream)` adapts a legacy (streams1) `'data'`/
 * `'end'` emitter: the wrapping Readable emits the legacy chunks and `wrap`
 * returns the Readable. Asserted head-to-head against real Node.
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    const { EventEmitter } = require('node:events');
    (async () => {
      class Legacy extends EventEmitter {
        pause() { this.paused = true; }
        resume() { this.paused = false; }
      }
      const legacy = new Legacy();
      const r = new Readable({ objectMode: true, read() {} });
      const ret = r.wrap(legacy);
      console.log('returns-readable:' + (ret === r));
      const out = [];
      r.on('data', (c) => out.push(c));
      setTimeout(() => { legacy.emit('data', 'L1'); legacy.emit('data', 'L2'); legacy.emit('end'); }, 5);
      await new Promise((res) => setTimeout(res, 20));
      console.log('data:' + JSON.stringify(out));
    })();
  `,
};

export default c;
