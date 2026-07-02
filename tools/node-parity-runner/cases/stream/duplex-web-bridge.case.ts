import type { ParityCase } from '../../src/types.ts';

/**
 * `Duplex.toWeb(d)` → `{ readable, writable }` (both real WHATWG streams) that
 * round-trips a `Transform`. `Duplex.fromWeb(pair)` composes a Node `Duplex`
 * (`instanceof Duplex`) — with `allowHalfOpen` defaulting to `false`, the
 * OPPOSITE of a bare `new Duplex()` (which defaults `true`); `{allowHalfOpen:
 * true}` honored; a non-WHATWG arg → sync TypeError. Asserted vs real Node.
 */
const c: ParityCase = {
  code: `
    const { Duplex, Transform } = require('node:stream');
    (async () => {
      // toWeb shape + round-trip.
      const d = new Transform({ objectMode: true, transform(c, e, cb) { cb(null, 'T:' + c); } });
      const pair = Duplex.toWeb(d);
      console.log('toweb-keys:' + Object.keys(pair).sort().join(','));
      console.log('toweb-readable:' + (pair.readable instanceof ReadableStream));
      console.log('toweb-writable:' + (pair.writable instanceof WritableStream));
      const writer = pair.writable.getWriter();
      const reader = pair.readable.getReader();
      await writer.write('a');
      const r1 = await reader.read();
      console.log('toweb-roundtrip:' + r1.value);

      // bare Duplex allowHalfOpen default.
      const bare = new Duplex({ read() {}, write(c, e, cb) { cb(); } });
      console.log('bare-allowhalfopen:' + bare.allowHalfOpen);

      // fromWeb instance + allowHalfOpen defaults.
      const readableA = new ReadableStream({ start(c) { c.enqueue('x'); c.close(); } });
      const writableA = new WritableStream({ write() {} });
      const dA = Duplex.fromWeb({ readable: readableA, writable: writableA });
      console.log('fromweb-instance:' + (dA instanceof Duplex));
      console.log('fromweb-allowhalfopen-default:' + dA.allowHalfOpen);

      const readableB = new ReadableStream({ start(c) { c.close(); } });
      const writableB = new WritableStream({ write() {} });
      const dB = Duplex.fromWeb({ readable: readableB, writable: writableB }, { allowHalfOpen: true });
      console.log('fromweb-allowhalfopen-true:' + dB.allowHalfOpen);

      // non-WHATWG arg -> sync TypeError.
      let badArg = 'no-throw';
      try { Duplex.fromWeb(42); } catch (e) { badArg = e.constructor.name; }
      console.log('fromweb-badarg:' + badArg);
    })();
  `,
};

export default c;
