import type { ParityCase } from '../../src/types.ts';

/**
 * Callback-overload `randomBytes(size, cb)` + `randomFill(buf[, off, size], cb)`
 * (Node v0.5 / v7.10) — thin async wrappers over the sync fill core. Pins the
 * observable async contract head-to-head against Node: the callback is deferred
 * (the synchronous `sync-first` marker is logged before any callback fires),
 * `err` is `null`, `randomBytes` yields a byte view of the requested length,
 * and `randomFill` resolves with the SAME buffer instance it was handed.
 * Random bytes themselves are never printed (non-deterministic) — only shape.
 * (`instanceof Uint8Array`, not `Buffer.isBuffer`: cross-realm Buffer identity
 * differs in the parity harness; `isBuffer` is covered by the unit test.)
 */
const c: ParityCase = {
  expected: [
    'sync-first',
    'rb:err=null isU8=true len=8',
    'rf:err=null same=true len=4',
    'rf-os:err=null same=true len=4',
  ].join('\n'),
  code: `
    const crypto = require('node:crypto');
    const log = [];
    crypto.randomBytes(8, (err, buf) => {
      log.push('rb:err=' + JSON.stringify(err) + ' isU8=' + (buf instanceof Uint8Array) + ' len=' + buf.length);
      const b = Buffer.alloc(4);
      crypto.randomFill(b, (e, bb) => {
        log.push('rf:err=' + JSON.stringify(e) + ' same=' + (bb === b) + ' len=' + bb.length);
        crypto.randomFill(b, 1, 2, (e2, bb2) => {
          log.push('rf-os:err=' + JSON.stringify(e2) + ' same=' + (bb2 === b) + ' len=' + bb2.length);
          console.log(log.join('\\n'));
        });
      });
    });
    log.push('sync-first');
  `,
};

export default c;
