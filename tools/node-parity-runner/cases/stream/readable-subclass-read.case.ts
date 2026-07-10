/**
 * Real ecosystem producers (including readdirp) subclass Readable and provide
 * `_read()` on the prototype instead of passing `{ read() {} }` to `super()`.
 * Both producer forms are one Node stream contract.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');

    class EntryStream extends Readable {
      constructor() {
        super({ objectMode: true });
        this.calls = 0;
      }
      _read(size) {
        this.calls += 1;
        this.push({ name: 'src', size });
        this.push(null);
      }
    }

    const stream = new EntryStream();
    const entries = [];
    stream.on('data', (entry) => entries.push(entry));
    stream.on('end', () => {
      console.log('calls:', stream.calls);
      console.log('entries:', JSON.stringify(entries));
    });

    const base = new Readable();
    console.log('base hook:', typeof base._read);
    try {
      base._read(1);
    } catch (error) {
      console.log('base error:', error.code, error.message);
    }
  `,
};

export default c;
