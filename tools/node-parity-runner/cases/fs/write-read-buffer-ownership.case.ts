import type { ParityCase } from '../../src/types.ts';

/**
 * File bytes never share memory with a buffer the program holds: mutating the
 * buffer after a write, or the buffer a read returned, leaves the file alone.
 * Siblings: `write-array-buffer-view-kinds`, `async-write-buffer-moment`,
 * `write-shared-array-buffer-ownership` (no SAB on no-COI), `read-stream-chunk-ownership`.
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { Buffer } = require('node:buffer');
    const show = (label, p) => console.log(label, Array.from(fs.readFileSync(p)).join(','));

    const u8 = new Uint8Array([1, 2, 3]);
    fs.writeFileSync('a', u8);
    u8.fill(9);
    show('writeFileSync u8', 'a');
    const buf = Buffer.from([1, 2, 3]);
    fs.writeFileSync('b', buf);
    buf.fill(9);
    show('writeFileSync Buffer', 'b');
    const pooled = Buffer.allocUnsafe(3);
    pooled.set([1, 2, 3]);
    fs.writeFileSync('c', pooled);
    pooled.fill(9);
    Buffer.allocUnsafe(64).fill(9);
    show('writeFileSync allocUnsafe', 'c');
    const whole = new Uint8Array([0, 1, 2, 3, 4]);
    fs.writeFileSync('d', whole.subarray(1, 4));
    whole.fill(9);
    show('writeFileSync subarray', 'd');
    fs.writeFileSync('h', 'abc');
    Buffer.allocUnsafe(64).fill(0x7a);
    console.log('writeFileSync string', fs.readFileSync('h', 'utf8'));
    const wx = new Uint8Array([1, 2]);
    fs.writeFileSync('i', wx, { flag: 'wx' });
    wx.fill(9);
    show('writeFileSync wx', 'i');
    fs.writeFileSync('j', 'zzzzz');
    const rplus = new Uint8Array([1, 2]);
    fs.writeFileSync('j', rplus, { flag: 'r+' });
    rplus.fill(9);
    show('writeFileSync r+', 'j');
    const appNew = new Uint8Array([1, 2]);
    fs.appendFileSync('k', appNew);
    appNew.fill(9);
    show('appendFileSync new file', 'k');
    const appOld = new Uint8Array([3]);
    fs.appendFileSync('k', appOld);
    appOld.fill(9);
    show('appendFileSync existing', 'k');
    const fd = fs.openSync('l', 'w');
    const w1 = new Uint8Array([1, 2, 3]);
    fs.writeSync(fd, w1);
    w1.fill(9);
    const w2 = new Uint8Array([4]);
    fs.writeSync(fd, w2, 0, 1, 0);
    w2.fill(9);
    fs.closeSync(fd);
    show('writeSync fd', 'l');
    fs.writeFileSync('m', new Uint8Array([1, 2, 3]));
    fs.copyFileSync('m', 'n');
    fs.writeFileSync('m', new Uint8Array([9]));
    show('copyFileSync dst', 'n');

    fs.writeFileSync('o', new Uint8Array([1, 2, 3]));
    const read = fs.readFileSync('o');
    read.fill(9);
    show('readFileSync result mutated', 'o');
    const r1 = fs.readFileSync('o');
    const r2 = fs.readFileSync('o');
    r1.fill(9);
    console.log('readFileSync twice', Array.from(r2).join(','));
    const rfd = fs.openSync('o', 'r');
    const into = Buffer.alloc(3);
    fs.readSync(rfd, into, 0, 3, 0);
    into.fill(9);
    fs.closeSync(rfd);
    show('readSync target mutated', 'o');
    const before = fs.readFileSync('o');
    fs.writeFileSync('o', new Uint8Array([7, 7, 7]));
    console.log('read survives rewrite', Array.from(before).join(','));
  `,
};

export default c;
