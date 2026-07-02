import type { ParityCase } from '../../src/types.ts';

/**
 * `Writable.fromWeb` error propagation BOTH ways: `w.destroy(err)` → web sink
 * `abort(reason === err)`; web `controller.error(err)` → node `w` emits
 * `'error'(err)` + `w.destroyed`; and a non-WHATWG arg → synchronous TypeError.
 * Asserted head-to-head against real Node.
 */
const c: ParityCase = {
  code: `
    const { Writable } = require('node:stream');
    (async () => {
      // non-WHATWG arg -> sync TypeError (no async needed).
      let badArg = 'no-throw';
      try { Writable.fromWeb({}); } catch (e) { badArg = e.constructor.name; }
      console.log('badarg:' + badArg);

      // node destroy(err) -> sink abort(reason === err).
      const errA = new Error('node-destroy');
      const wsA = new WritableStream({ write() {}, abort(reason) { console.log('abort-is-err:' + (reason === errA)); } });
      const wA = Writable.fromWeb(wsA);
      wA.on('error', () => {});
      wA.destroy(errA);

      // web controller.error(err) -> node 'error'(err) + destroyed.
      const errB = new Error('web-error');
      let ctrl;
      const wsB = new WritableStream({ start(c) { ctrl = c; }, write() {} });
      const wB = Writable.fromWeb(wsB);
      wB.on('error', (e) => { console.log('node-err-is-err:' + (e === errB)); });
      ctrl.error(errB);

      await new Promise((r) => setTimeout(r, 15));
      console.log('web-err-destroyed:' + wB.destroyed);
    })();
  `,
};

export default c;
