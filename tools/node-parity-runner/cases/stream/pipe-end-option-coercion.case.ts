/**
 * `pipe(dest, opts)` skips `dest.end()` only for a literal `end: false` (Node's
 * `pipeOpts.end !== false`): falsy non-`false` values (`0`, `null`) still end.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  expected: ['{end: 0} ended true', '{end: null} ended true', '{end: false} ended false'].join(
    '\n',
  ),
  code: `
    const { Readable, Writable } = require('node:stream');
    function run(label, opts, next) {
      const w = new Writable({ write(_c, _e, cb) { cb(); } });
      const src = Readable.from(['x']);
      src.pipe(w, opts);
      src.once('end', () => setImmediate(() => { console.log(label + ' ended ' + w.writableEnded); next(); }));
    }
    run('{end: 0}', { end: 0 }, () => run('{end: null}', { end: null }, () =>
      run('{end: false}', { end: false }, () => {})));
  `,
};

export default c;
