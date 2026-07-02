import type { ParityCase } from '../../src/types.ts';

/**
 * `Writable.toWeb` destroy→error mapping: `w.destroy(err)` rejects the writer's
 * `closed` with that error. (A SEPARATE case covers `writer.abort(reason)` →
 * `w.destroy(reason)`; each is one short async tail so the in-process rifty
 * harness drains it without truncation.) Asserted head-to-head against real Node.
 */
const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    (async () => {
      const err = new Error('toweb-destroy');
      const w = new Writable({ objectMode: true, write(c, e, cb) { cb(); } });
      const writer = Writable.toWeb(w).getWriter();
      let closedMsg = 'no-reject';
      writer.closed.catch((e) => { closedMsg = e.message; });
      w.destroy(err);
      await new Promise((r) => setTimeout(r, 20));
      console.log('closed-rejected:' + closedMsg);
    })();
  `,
};

export default c;
