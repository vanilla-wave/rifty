import type { ParityCase } from '../../src/types.ts';

/**
 * `Readable` + `async _read` contract vs real Node (v24):
 *   - the RETURN VALUE of `_read` is ignored — a fulfilled promise does NOT
 *     re-trigger `_read`; `reading` is cleared only by `push()`
 *     (`readableAddChunk`). A no-push async `_read` is called ONCE and then
 *     waited on — never spun on microtasks (a spin starves the realm's timers
 *     and IPC: the PR-125 owner wedge).
 *   - a chunk pushed while the promise is still pending clears `reading` and
 *     allows the NEXT `_read` — the pending promise does not serialize reads.
 *   - promise REJECTION is NOT converted into `destroy(err)`/`'error'` — it
 *     surfaces as an unhandled rejection (the case holds + catches the promise
 *     so both engines stay clean).
 *   - a SYNC throw inside `_read` does NOT propagate to the `read()` caller —
 *     Node destroys the stream with the error (`'error'` + `destroyed`).
 *
 * The no-push producer stops returning promises after 50 calls so a
 * regression prints a huge call count instead of hanging the runner.
 */
const c: ParityCase = {
  code: `
    const { Readable } = require('node:stream');
    (async () => {
      // Settle emission cascades with ONE 1ms timer hop per row: Node's flow
      // runs on nextTick+macrotask (microtask loops don't reach it), while the
      // runner's capture window budgets only ~25ms of host-timer grace for the
      // WHOLE case — so every row must stay a single short hop.
      const settle = () => new Promise((res) => setTimeout(res, 1));
      // 1. no-push async _read: called once, timers keep firing.
      let calls1 = 0;
      const r1 = new Readable({
        objectMode: true,
        read() {
          calls1++;
          if (calls1 > 50) return; // bound a regression spin, keep it diffable
          return (async () => {})();
        },
      });
      r1.on('data', () => {});
      let timerFired = false;
      setTimeout(() => { timerFired = true; }, 5);
      await new Promise((res) => setTimeout(res, 10));
      console.log('no-push: calls=' + calls1 + ' timer=' + timerFired);

      // 2. early push while the promise is still pending: data delivered,
      // reading cleared by push -> a second _read is allowed.
      let calls2 = 0;
      const seen2 = [];
      const r2 = new Readable({
        objectMode: true,
        read() {
          calls2++;
          if (calls2 === 1) {
            this.push('a');
            return new Promise(() => {});
          }
        },
      });
      r2.on('data', (chunk) => seen2.push(chunk));
      await settle();
      console.log('early-push: calls=' + calls2 + ' seen=' + JSON.stringify(seen2));

      // 3. push after await: delivered, ended, no extra reads after EOF.
      let calls3 = 0;
      const seen3 = [];
      const r3 = new Readable({
        objectMode: true,
        async read() {
          calls3++;
          if (calls3 > 1) return;
          await Promise.resolve();
          this.push('x');
          this.push('y');
          this.push(null);
        },
      });
      r3.on('data', (chunk) => seen3.push(chunk));
      await settle();
      console.log(
        'push-after-await: calls=' + calls3 +
        ' seen=' + JSON.stringify(seen3) +
        ' ended=' + r3.readableEnded,
      );

      // 4. rejection: NOT destroy/'error'. Real Node surfaces it as an
      // unhandledRejection (default mode: process crash) — the case attaches
      // a catch IN THE SAME TURN so both engines stay alive and diffable.
      let caught = null;
      const r4 = new Readable({
        objectMode: true,
        read() {
          const p = (async () => { throw new Error('boom'); })();
          p.catch((err) => { caught = err.message; });
          return p;
        },
      });
      let error4 = null;
      r4.on('data', () => {});
      r4.on('error', (err) => { error4 = err.message; });
      await settle();
      console.log(
        'rejection: destroyed=' + r4.destroyed +
        ' error=' + error4 +
        ' caught=' + caught,
      );

      // 5. sync throw: 'error' + destroyed, NOT thrown to the read() caller.
      const r5 = new Readable({ objectMode: true, read() { throw new Error('sync-boom'); } });
      let error5 = null;
      let threw5 = null;
      r5.on('error', (err) => { error5 = err.message; });
      try { r5.read(0); } catch (err) { threw5 = err.message; }
      await settle();
      console.log('sync-throw: threw=' + threw5 + ' error=' + error5 + ' destroyed=' + r5.destroyed);
    })();
  `,
};

export default c;
