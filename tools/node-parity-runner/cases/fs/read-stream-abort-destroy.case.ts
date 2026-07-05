import type { ParityCase } from '../../src/types.ts';

/**
 * AbortSignal / destroy() timing on `fs.createReadStream` (review 2026-07-05
 * handoff #1, orders probed against Node v24): Node still OPENS the fd for a
 * pre-aborted signal — abort error + 'close' fire first, 'open'/'ready' trail
 * once the open completes; a MISSING target never opens and its ENOENT is
 * swallowed (only the abort error surfaces). destroy() right after create also
 * completes the open: open|ready|close. Abort AFTER 'end' is a no-op.
 */
const c: ParityCase = {
  cwd: '/app',
  setup: {
    files: {
      'app/data.txt': 'hello world',
      'app/big.txt': 'x'.repeat(300000),
    },
  },
  code: `
    const fs = require('node:fs');
    // timers/promises: keepalive-counted on the rifty side, so the harness
    // drain waits the sleeps out instead of truncating the capture.
    const { setTimeout: sleep } = require('node:timers/promises');
    const watchEvents = (s) => {
      const ev = [];
      for (const n of ['open', 'ready', 'end']) s.on(n, () => ev.push(n));
      s.on('data', () => ev.push('data'));
      s.on('error', (e) => ev.push('error:' + (e.name ?? '') + ':' + (e.code ?? '')));
      s.on('close', () => ev.push('close'));
      return ev;
    };

    (async () => {
      const pre = new AbortController(); pre.abort();
      const ev1 = watchEvents(fs.createReadStream('data.txt', { signal: pre.signal }));
      await sleep(60);
      console.log('pre-aborted-existing:', ev1.join('|'));

      const preMiss = new AbortController(); preMiss.abort();
      const ev2 = watchEvents(fs.createReadStream('missing.txt', { signal: preMiss.signal }));
      await sleep(60);
      console.log('pre-aborted-missing:', ev2.join('|'));

      const mid = new AbortController();
      const rs3 = fs.createReadStream('big.txt', { signal: mid.signal, highWaterMark: 1024 });
      const ev3 = [];
      for (const n of ['open', 'ready', 'end']) rs3.on(n, () => ev3.push(n));
      let firstData = false;
      rs3.on('data', () => {
        if (!firstData) { firstData = true; ev3.push('data'); mid.abort(); }
      });
      rs3.on('error', (e) => ev3.push('error:' + (e.name ?? '') + ':' + (e.code ?? '')));
      rs3.on('close', () => ev3.push('close'));
      await sleep(80);
      console.log('abort-after-first-data:', ev3.join('|'));

      const late = new AbortController();
      const rs4 = fs.createReadStream('data.txt', { signal: late.signal });
      const ev4 = watchEvents(rs4);
      await new Promise((res) => rs4.on('close', res));
      late.abort();
      await sleep(60);
      console.log('abort-after-end:', ev4.join('|'));

      const rs5 = fs.createReadStream('data.txt');
      const ev5 = watchEvents(rs5);
      rs5.destroy();
      await sleep(60);
      console.log('destroy-pre-open:', ev5.join('|'));
    })();
  `,
};

export default c;
