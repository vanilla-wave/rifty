import type { ParityCase } from '../../src/types.ts';

/**
 * `stream.getDefaultHighWaterMark(objectMode)` and `setDefaultHighWaterMark`
 * vs real Node: the byte/object defaults match Node's current values, a `set`
 * is observed by subsequently-constructed Readable/Writable that pass no
 * explicit `highWaterMark`, and an explicit `{ highWaterMark }` still wins. The
 * default is restored at the end so the value does not leak across the runner's
 * in-process cases.
 */
const c: ParityCase = {
  code: `
    const s = require('node:stream');
    const { Readable, Writable } = s;
    const byteDefault = s.getDefaultHighWaterMark(false);
    const objDefault = s.getDefaultHighWaterMark(true);
    console.log('byte-default:' + byteDefault);
    console.log('obj-default:' + objDefault);

    // A ctor with no explicit HWM picks up the current default.
    console.log('readable-default-hwm:' + new Readable({ read() {} }).readableHighWaterMark);
    console.log('writable-default-hwm:' + new Writable({ write(_c,_e,cb){cb();} }).writableHighWaterMark);

    // Change the byte default; new ctors observe it.
    s.setDefaultHighWaterMark(false, 1024);
    console.log('after-set-readable:' + new Readable({ read() {} }).readableHighWaterMark);
    console.log('after-set-writable:' + new Writable({ write(_c,_e,cb){cb();} }).writableHighWaterMark);
    // Explicit option still wins over the changed default.
    console.log('explicit-wins:' + new Readable({ read() {}, highWaterMark: 7 }).readableHighWaterMark);
    // Object-mode default is independent of the byte default change.
    console.log('obj-still:' + s.getDefaultHighWaterMark(true));

    // Restore so the in-process runner does not leak the changed default.
    s.setDefaultHighWaterMark(false, byteDefault);
    console.log('restored:' + new Readable({ read() {} }).readableHighWaterMark);
  `,
};

export default c;
