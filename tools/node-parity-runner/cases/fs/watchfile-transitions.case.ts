import type { ParityCase } from '../../src/types.ts';

/**
 * `fs.watchFile` existence/kind transitions (review 2026-07-05 handoff #4,
 * probed against Node v24): a MISSING target invokes the listener ONCE with
 * all-zero curr AND prev; creation fires curr=real/prev=zeros; deletion fires
 * curr=zeros; a file→directory swap fires with the kind flipped. Mutations are
 * same-tick so the poll timer can never observe an intermediate state; sleeps
 * are generous multiples of the 40ms interval.
 */
const c: ParityCase = {
  cwd: '/app',
  setup: { files: { 'app/keep.txt': 'k' } },
  code: `
    const fs = require('node:fs');
    // timers/promises: keepalive-counted on the rifty side (harness drain caps
    // at 1s — sleeps are sized to keep the whole case under it).
    const { setTimeout: sleep } = require('node:timers/promises');
    const shape = (s) => 'file=' + s.isFile() + ' dir=' + s.isDirectory() +
      ' size0=' + (s.size === 0) + ' mtime0=' + (Number(s.mtimeMs ?? s.mtime) === 0);

    (async () => {
      const calls = [];
      fs.watchFile('ghost.txt', { interval: 30 }, (curr, prev) => calls.push([curr, prev]));
      await sleep(150);
      console.log('missing-at-start:', calls.length,
        calls[0] ? shape(calls[0][0]) + ' | prev ' + shape(calls[0][1]) : '');
      calls.length = 0;

      fs.writeFileSync('ghost.txt', 'created');
      await sleep(150);
      console.log('created:', calls.length,
        calls[0] ? shape(calls[0][0]) + ' | prev ' + shape(calls[0][1]) : '');
      calls.length = 0;

      fs.unlinkSync('ghost.txt');
      await sleep(150);
      console.log('deleted:', calls.length,
        calls[0] ? shape(calls[0][0]) + ' | prev ' + shape(calls[0][1]) : '');
      fs.unwatchFile('ghost.txt');

      fs.writeFileSync('swap', 'f');
      const swaps = [];
      fs.watchFile('swap', { interval: 30 }, (curr, prev) => swaps.push([curr, prev]));
      await sleep(100);
      fs.unlinkSync('swap');
      fs.mkdirSync('swap');
      await sleep(150);
      console.log('file-to-dir:', swaps.length,
        swaps[0] ? 'prevFile=' + swaps[0][1].isFile() + ' currDir=' + swaps[0][0].isDirectory() : '');
      fs.unwatchFile('swap');
    })();
  `,
};

export default c;
