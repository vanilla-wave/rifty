/**
 * Per Node docs (`Readable.read(size)`):
 *   - If `size` bytes are available, returns a chunk of exactly that many bytes
 *     (string-mode/binary-mode).
 *   - If the internal buffer has fewer than `size` bytes, returns `null` and
 *     schedules `_read` to fetch more.
 *
 * Our previous `read()` ignored `size` and just shifted the first buffer entry.
 * That diverges visibly for binary-mode streams where the consumer drives
 * frame-aligned reads (e.g. `tar-stream` taking 512-byte headers).
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    const src = new Readable({
      read() {},
    });
    // Push a few Buffers; consumer asks for exact byte counts.
    src.push(Buffer.from([1, 2, 3, 4]));
    src.push(Buffer.from([5, 6, 7, 8]));
    src.push(Buffer.from([9, 10, 11, 12]));
    src.push(null);
    // First read(2) — should return first 2 bytes.
    src.on('readable', () => {
      const chunks = [];
      let chunk;
      while ((chunk = src.read(2)) !== null) {
        chunks.push(Array.from(chunk));
      }
      // Drain remainder via read() with no size.
      const tail = src.read();
      if (tail) chunks.push(Array.from(tail));
      console.log(JSON.stringify(chunks));
    });
  `,
};

export default c;
