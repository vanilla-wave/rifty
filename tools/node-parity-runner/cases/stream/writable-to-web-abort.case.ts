import type { ParityCase } from '../../src/types.ts';

/**
 * `Writable.toWeb`: `writer.abort(reason)` destroys the Node writable with that
 * reason (`w.destroyed`, the `'error'` carries the reason). Asserted vs real
 * Node. (Sibling of `writable-to-web-errors`, which covers the destroy→`closed`
 * direction; split so each case has one short async tail.)
 */
const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    (async () => {
      const reason = new Error('toweb-abort');
      const w = new Writable({ objectMode: true, write(c, e, cb) { cb(); } });
      let evtMsg = 'none';
      w.on('error', (e) => { evtMsg = e.message; });
      const writer = Writable.toWeb(w).getWriter();
      await writer.abort(reason);
      await new Promise((r) => setTimeout(r, 20));
      console.log('abort-destroyed:' + w.destroyed);
      console.log('abort-error:' + evtMsg);
    })();
  `,
};

export default c;
