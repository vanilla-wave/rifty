import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    // undici's web/webidl/index.js does
    //   const { markAsUncloneable } = require('node:worker_threads')
    // and assigns it to webidl.util.markAsUncloneable, which every web class
    // (Headers, Request, Response, FormData, CacheStorage, WebSocket, ...) calls
    // in its constructor. markAsUntransferable / isMarkedAsUntransferable are the
    // paired Node v22+ functions. Exercise the parity-observable surface: the
    // marker functions exist, return undefined, no-op on non-objects, and the
    // isMarkedAsUntransferable round-trip reports the tag faithfully.
    const wt = require('node:worker_threads');

    console.log('markAsUncloneable type', typeof wt.markAsUncloneable);
    console.log('markAsUntransferable type', typeof wt.markAsUntransferable);
    console.log('isMarkedAsUntransferable type', typeof wt.isMarkedAsUntransferable);

    // Return values are undefined (markers are side-effecting).
    console.log('markAsUncloneable ret', wt.markAsUncloneable({}) === undefined ? 1 : 0);
    console.log('markAsUntransferable ret', wt.markAsUntransferable({}) === undefined ? 1 : 0);

    // No-op (no throw) on non-objects — both must tolerate primitives/null.
    const tolerate = (fn, v) => {
      try { fn(v); return 1; } catch { return 0; }
    };
    console.log('uncloneable tolerates 5', tolerate(wt.markAsUncloneable, 5));
    console.log('uncloneable tolerates null', tolerate(wt.markAsUncloneable, null));
    console.log('untransferable tolerates 5', tolerate(wt.markAsUntransferable, 5));
    console.log('untransferable tolerates null', tolerate(wt.markAsUntransferable, null));

    // isMarkedAsUntransferable: false for non-objects / unmarked.
    console.log('isMarked undefined', wt.isMarkedAsUntransferable(undefined) ? 1 : 0);
    console.log('isMarked null', wt.isMarkedAsUntransferable(null) ? 1 : 0);
    console.log('isMarked 5', wt.isMarkedAsUntransferable(5) ? 1 : 0);
    console.log('isMarked plain ab', wt.isMarkedAsUntransferable(new ArrayBuffer(8)) ? 1 : 0);
    console.log('isMarked plain obj', wt.isMarkedAsUntransferable({}) ? 1 : 0);

    // Round-trip: marking an ArrayBuffer makes isMarkedAsUntransferable true.
    const ab = new ArrayBuffer(8);
    wt.markAsUntransferable(ab);
    console.log('isMarked marked ab', wt.isMarkedAsUntransferable(ab) ? 1 : 0);

    // Round-trip on a plain object too.
    const o = { x: 1 };
    wt.markAsUntransferable(o);
    console.log('isMarked marked obj', wt.isMarkedAsUntransferable(o) ? 1 : 0);

    // Marking must not add enumerable own properties.
    const k = { a: 1 };
    wt.markAsUncloneable(k);
    wt.markAsUntransferable(k);
    console.log('keys after mark', JSON.stringify(Object.keys(k)));

    // Double-marking is tolerated.
    console.log('double mark', tolerate(wt.markAsUncloneable, k) && tolerate(wt.markAsUntransferable, k));
  `,
};

export default c;
