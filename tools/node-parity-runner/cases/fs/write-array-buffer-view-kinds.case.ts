import type { ParityCase } from '../../src/types.ts';

/**
 * writeFileSync/appendFileSync/promises.writeFile of every ArrayBufferView kind write its raw bytes
 * (byteOffset 0 and ≠ 0), copied: refilling the view's memory after the call leaves the file alone.
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const bytes = (p) => Array.from(fs.readFileSync(p)).join(',');
    const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array,
      Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView];
    (async () => {
      let n = 0;
      for (const Kind of kinds) {
        const per = Kind === DataView ? 1 : Kind.BYTES_PER_ELEMENT;
        for (const offset of [0, per]) {
          const raw = new Uint8Array(offset + 2 * per);
          for (let i = 0; i < raw.length; i++) raw[i] = i + 1;
          const view = Kind === DataView
            ? new DataView(raw.buffer, offset, 2)
            : new Kind(raw.buffer, offset, 2);
          const sync = 'v' + n++;
          fs.writeFileSync(sync, view);
          const app = 'v' + n++;
          fs.appendFileSync(app, view);
          const prom = 'v' + n++;
          await fs.promises.writeFile(prom, view);
          raw.fill(0);
          console.log(Kind.name, 'offset', offset, bytes(sync), '|', bytes(app), '|', bytes(prom));
        }
      }
    })();
  `,
};

export default c;
