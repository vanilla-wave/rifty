import type { ParityCase } from '../../src/types.ts';

/**
 * Write-stream destroy() event/callback/content truth, golden from real Node —
 * the PR #115 blocker class "unverified Node assumption frozen as a
 * conformance test". Node's rule sits on the write-DISPATCH boundary (all
 * probed v24, both micro-timings):
 *  - pre-open destroy: open still COMPLETES (open|ready|close), buffered
 *    writes discarded (file empty), cbs get ERR_STREAM_DESTROYED, NO 'error';
 *  - write/end(chunk) issued synchronously INSIDE the 'ready' handler +
 *    destroy: not yet dispatched — discarded silently, NO 'error';
 *  - the same pair one microtask later (after awaiting 'ready'): the write is
 *    IN FLIGHT — its bytes LAND in the file, the cb still errors, and the
 *    stream EMITS 'error';
 *  - chunkless end(cb) + destroy: callback-only, NO 'error';
 *  - fully flushed then destroy: clean close, cb ok.
 */
const c: ParityCase = {
  setup: { files: { 'seed.txt': 'x' } },
  code: `
    const fs = require('node:fs');
    const { setTimeout: sleep } = require('node:timers/promises');
    const run = async (label, fn) => {
      const events = [];
      const file = label + '.log';
      const ws = fs.createWriteStream(file);
      for (const ev of ['open', 'ready', 'error', 'close', 'finish']) {
        ws.on(ev, (a) => events.push(ev + (a && a.code ? ':' + a.code : '')));
      }
      await fn(ws, (tag) => (err) => events.push(tag + ':' + (err ? err.code : 'ok')));
      await sleep(100);
      console.log(label + ':', events.join(' | '),
        '|| file=' + JSON.stringify(fs.readFileSync(file, 'utf8')));
    };
    const main = async () => {
      await run('destroy-preopen-write', async (ws, cb) => {
        ws.write('data', cb('writecb'));
        ws.destroy();
      });
      await run('destroy-insideready-write', async (ws, cb) => {
        await new Promise((resolve) => ws.on('ready', () => {
          ws.write('data', cb('writecb'));
          ws.destroy();
          resolve();
        }));
      });
      await run('destroy-postopen-write', async (ws, cb) => {
        await new Promise((resolve) => ws.on('ready', resolve));
        ws.write('data', cb('writecb'));
        ws.destroy();
      });
      await run('destroy-postopen-end', async (ws, cb) => {
        await new Promise((resolve) => ws.on('ready', resolve));
        ws.end('x', cb('endcb'));
        ws.destroy();
      });
      await run('destroy-postopen-end-nochunk', async (ws, cb) => {
        await new Promise((resolve) => ws.on('ready', resolve));
        ws.end(cb('endcb'));
        ws.destroy();
      });
      await run('destroy-after-flush', async (ws, cb) => {
        await new Promise((resolve) => ws.on('ready', resolve));
        ws.write('data', cb('writecb'));
        await sleep(50);
        ws.destroy();
      });
    };
    main();
  `,
};

export default c;
