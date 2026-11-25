import type { ParityCase } from '../../src/types.ts';

/**
 * Positional fd reads (ADR-0576): explicit/null/-1 positions, EOF short reads,
 * truncate/extend between calls, bigint positions and their bounds, zero length,
 * a directory fd, `fs.read` callbacks. Positions -1 and number reads: also
 * `fd-read-write-position.case.ts`.
 */
const c: ParityCase = {
  setup: {
    files: {
      'p.txt': 'abcdefghij',
    },
  },
  code: `
    const fs = require('node:fs');
    const show = (label, fn) => {
      try {
        const buf = Buffer.alloc(4, 0x2e);
        const n = fn(buf);
        console.log(label, n, buf.toString('latin1'));
      } catch (e) {
        console.log(label, 'throws', e.name, e.code, e.message);
      }
    };
    const fd = fs.openSync('p.txt', 'r');
    show('explicit 2', (b) => fs.readSync(fd, b, 0, 4, 2));
    show('null 1', (b) => fs.readSync(fd, b, 0, 4, null));
    show('null 2', (b) => fs.readSync(fd, b, 0, 4, null));
    show('null 3 short', (b) => fs.readSync(fd, b, 0, 4, null));
    show('null 4 eof', (b) => fs.readSync(fd, b, 0, 4, null));
    show('explicit at eof', (b) => fs.readSync(fd, b, 0, 4, 10));
    show('explicit past eof', (b) => fs.readSync(fd, b, 0, 4, 1000));
    show('short tail', (b) => fs.readSync(fd, b, 1, 3, 8));
    show('zero length', (b) => fs.readSync(fd, b, 0, 0, 3));
    show('options position', (b) => fs.readSync(fd, b, { position: 6 }));
    show('bigint 3n', (b) => fs.readSync(fd, b, 0, 4, 3n));
    show('options bigint', (b) => fs.readSync(fd, b, { offset: 1, length: 2, position: 7n }));
    show('bigint 2^53 eof', (b) => fs.readSync(fd, b, 0, 4, 2n ** 53n));
    show('bigint max ok eof', (b) => fs.readSync(fd, b, 0, 4, 2n ** 63n - 5n));
    show('bigint over max', (b) => fs.readSync(fd, b, 0, 4, 2n ** 63n - 4n));
    show('bigint -2n', (b) => fs.readSync(fd, b, 0, 4, -2n));
    show('number -2', (b) => fs.readSync(fd, b, 0, 4, -2));
    show('number 1.5', (b) => fs.readSync(fd, b, 0, 4, 1.5));
    show('string position', (b) => fs.readSync(fd, b, 0, 4, '1'));
    // A zero length returns 0 only after the position is validated.
    show('zero length -5', (b) => fs.readSync(fd, b, 0, 0, -5));
    show('zero length string', (b) => fs.readSync(fd, b, 0, 0, 'x'));
    show('zero length 1.5', (b) => fs.readSync(fd, b, 0, 0, 1.5));
    show('zero length options string', (b) => fs.readSync(fd, b, { length: 0, position: 'x' }));
    show('zero length offset past buffer', (b) => fs.readSync(fd, b, 9, 0, 0));
    fs.closeSync(fd);

    // bigint -1n reads from the fd position and advances it.
    const seq = fs.openSync('p.txt', 'r');
    show('-1n first', (b) => fs.readSync(seq, b, 0, 3, -1n));
    show('-1n second', (b) => fs.readSync(seq, b, 0, 3, -1n));
    // Explicit positions leave the fd position alone.
    show('explicit keeps', (b) => fs.readSync(seq, b, 0, 2, 0));
    show('then null', (b) => fs.readSync(seq, b, 0, 3, null));
    fs.closeSync(seq);

    // Truncated, then extended, between calls on one open fd.
    fs.writeFileSync('t.bin', '0123456789');
    const t = fs.openSync('t.bin', 'r');
    show('before truncate', (b) => fs.readSync(t, b, 0, 4, null));
    fs.truncateSync('t.bin', 6);
    show('after truncate', (b) => fs.readSync(t, b, 0, 4, null));
    show('after truncate eof', (b) => fs.readSync(t, b, 0, 4, null));
    fs.appendFileSync('t.bin', 'XYZ');
    show('after extend', (b) => fs.readSync(t, b, 0, 4, null));
    fs.truncateSync('t.bin', 0);
    show('after empty', (b) => fs.readSync(t, b, 0, 4, 0));
    fs.closeSync(t);

    // A large positional read: one call, its exact range.
    const big = Buffer.alloc(700 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 251;
    fs.writeFileSync('big.bin', big);
    const g = fs.openSync('big.bin', 'r');
    const range = Buffer.alloc(600 * 1024);
    const n = fs.readSync(g, range, 0, range.length, 50 * 1024 + 3);
    console.log('big', n, range.equals(big.subarray(50 * 1024 + 3, 50 * 1024 + 3 + n)));
    const tail = Buffer.alloc(64 * 1024);
    console.log('big tail', fs.readSync(g, tail, 0, tail.length, big.length - 10));
    fs.closeSync(g);

    // A directory fd: zero length is 0 before any read; otherwise EISDIR.
    fs.mkdirSync('d');
    const dfd = fs.openSync('d', 'r');
    show('dir zero', (b) => fs.readSync(dfd, b, 0, 0, null));
    show('dir read', (b) => fs.readSync(dfd, b, 0, 4, null));
    fs.closeSync(dfd);

    // A zero length reaches no fd: a write-only or a closed fd reads 0.
    const wo = fs.openSync('wo.txt', 'w');
    show('write-only zero', (b) => fs.readSync(wo, b, 0, 0, 0));
    show('write-only read', (b) => fs.readSync(wo, b, 0, 2, 0));
    fs.closeSync(wo);
    show('closed fd zero', (b) => fs.readSync(wo, b, 0, 0, 0));

    // fs.read validates the position synchronously, stdin included.
    for (const [label, target, position] of [['read -5', 'p.txt', -5], ['read string', 'p.txt', 'x'], ['read -2n', 'p.txt', -2n]]) {
      const tfd = fs.openSync(target, 'r');
      try {
        fs.read(tfd, Buffer.alloc(2), 0, 2, position, () => console.log(label, 'callback'));
        console.log(label, 'no sync throw');
      } catch (e) {
        console.log(label, 'sync throw', e.code);
      }
      fs.closeSync(tfd);
    }
    try {
      fs.read(0, Buffer.alloc(2), 0, 2, -2n, () => console.log('stdin -2n callback'));
      console.log('stdin -2n no sync throw');
    } catch (e) {
      console.log('stdin -2n sync throw', e.code);
    }

    // fs.read callbacks, explicit / null / bigint positions.
    const afd = fs.openSync('p.txt', 'r');
    const abuf = Buffer.alloc(3, 0x2e);
    fs.read(afd, abuf, 0, 3, 5, (e1, n1) => {
      console.log('read explicit', e1 && e1.code, n1, abuf.toString());
      fs.read(afd, abuf, 0, 3, null, (e2, n2) => {
        console.log('read null', e2 && e2.code, n2, abuf.toString());
        fs.read(afd, abuf, 0, 3, 8n, (e3, n3) => {
          console.log('read bigint', e3 && e3.code, n3, abuf.toString('latin1', 0, n3));
          fs.read(afd, { buffer: abuf, position: 1n }, (e4, n4) => {
            console.log('read options bigint', e4 && e4.code, n4, abuf.toString());
            fs.closeSync(afd);
          });
        });
      });
    });
  `,
};

export default c;
