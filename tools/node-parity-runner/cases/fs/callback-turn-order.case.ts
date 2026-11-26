import type { ParityCase } from '../../src/types.ts';

/**
 * fs callbacks (and `fs.promises` settlements) complete in a later event-loop turn, as Node's
 * threadpool completions do. Each op is called from inside an fs callback (Node's poll phase;
 * from other contexts rifty's order is declared: `runtime-js/loop-phase-of-current-turn`), with a tick, a promise, an
 * immediate and a 0 ms timer queued before and after it, then 3 ms of busy wait (both timers due).
 * Printed per op: which of those ran before the callback and which after, as sets: the
 * callback's place is this case's claim; the immediates' and timers' own order is
 * `fs/callback-phase-order` (as observed, not sorted), the ticks' against the promises' is the
 * in-process runner's artifact (`toolchain-build/parity-runner-next-tick-after-promise-jobs`). Then 256 callback reads (and `fs.promises` loops) under a 0 ms
 * interval: whether the interval ticked. Then the operation's own moment: the caller mutating the
 * written bytes after the call. `process`/timers are required
 * explicitly: the in-process runner's globals are Node's (trap parity-runner-in-process).
 * Node v24.16.0: order rows 40/40, moment rows 30/30 (+80/80 under load for order). Not printed (Node
 * varies, its threadpool runs beside the loop): `read`'s buffer right after the call (`000` 97/100,
 * `979899` 2, `09899` 1) or in a microtask, a sync read right
 * after an async write, single-round-trip `write(fd)` bytes mutated after the call (its threadpool races the
 * loop: same tick 119/120 `9,9,9`, microtask 179/180, `setImmediate` 16/30). Declared, not here
 * (`runtime-js/fs-async-op-io-rounds`): `writeFile`/`fs.promises.writeFile` bytes mutated in a
 * `setImmediate` — Node `9,9,9` (it opens a round trip first), rifty `1,2,3`.
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { Buffer } = require('node:buffer');
    const { nextTick } = require('node:process');
    const { setTimeout, setImmediate, setInterval, clearInterval } = require('node:timers');
    fs.writeFileSync('a.txt', 'abc');
    fs.writeFileSync('big.bin', Buffer.alloc(256 * 65536, 1));
    const fdR = fs.openSync('a.txt', 'r');
    const fdW = fs.openSync('w.txt', 'w');
    const outcome = (e, v) => (e ? e.code : 'ok' + (v === undefined ? '' : ' ' + v));
    const ops = [
      ['readFile', (cb) => fs.readFile('a.txt', 'utf8', (e, s) => cb(outcome(e, s)))],
      ['stat', (cb) => fs.stat('a.txt', (e, st) => cb(outcome(e, st && st.size)))],
      ['open', (cb) => fs.open('a.txt', 'r', (e, fd) => { if (!e) fs.closeSync(fd); cb(outcome(e)); })],
      ['read', (cb) => fs.read(fdR, Buffer.alloc(3), 0, 3, 0, (e, n, b) => cb(outcome(e, n + ' ' + b)))],
      ['write', (cb) => fs.write(fdW, 'xy', (e, n) => cb(outcome(e, n)))],
      ['close', (cb) => fs.close(fs.openSync('a.txt', 'r'), (e) => cb(outcome(e)))],
      ['appendFile', (cb) => fs.appendFile('ap.txt', 'z', (e) => cb(outcome(e)))],
      ['rm', (cb) => { fs.writeFileSync('rm.txt', ''); fs.rm('rm.txt', (e) => cb(outcome(e))); }],
      ['stat ENOENT', (cb) => fs.stat('nope.txt', (e) => cb(outcome(e)))],
      ['open ENOENT', (cb) => fs.open('nope.txt', 'r', (e) => cb(outcome(e)))],
      ['read EBADF', (cb) => fs.read(987654, Buffer.alloc(3), 0, 3, 0, (e) => cb(outcome(e)))],
      ['promises.readFile', (cb) => fs.promises.readFile('a.txt', 'utf8').then((s) => cb(outcome(null, s)), (e) => cb(outcome(e)))],
      ['promises.stat', (cb) => fs.promises.stat('a.txt').then((st) => cb(outcome(null, st.size)), (e) => cb(outcome(e)))],
      ['promises.stat ENOENT', (cb) => fs.promises.stat('nope.txt').then(() => cb('ok'), (e) => cb(outcome(e)))],
    ];
    const probe = ([name, op]) => new Promise((done) => fs.stat('.', () => {
      const seen = [];
      let result = null;
      // Printed once all nine have run, whatever the time (no fixed window).
      const report = () => {
        if (seen.length < 9) return;
        const at = seen.indexOf('cb');
        const group = (xs) => (xs.length ? xs.sort().join(',') : '-');
        console.log(name + ' => ' + result + '; before: ' + group(seen.slice(0, at)) + '; after: ' + group(seen.slice(at + 1)));
        done();
      };
      const mark = (label) => () => { seen.push(label); report(); };
      nextTick(mark('tick<'));
      Promise.resolve().then(mark('promise<'));
      setImmediate(mark('immediate<'));
      setTimeout(mark('timeout<'), 0);
      op((r) => { result = r; seen.push('cb'); report(); });
      nextTick(mark('tick>'));
      Promise.resolve().then(mark('promise>'));
      setImmediate(mark('immediate>'));
      setTimeout(mark('timeout>'), 0);
      const until = Date.now() + 3;
      while (Date.now() < until);
    }));
    const interleaved = () => new Promise((done) => {
      const got = [];
      const fin = (label) => (e, v) => { got.push(label + '=' + outcome(e, v)); if (got.length === 3) { console.log('interleaved => ' + got.sort().join(' ')); done(); } };
      fs.read(fdR, Buffer.alloc(3), 0, 3, 0, fin('read'));
      fs.write(fdW, 'z', fin('write'));
      fs.stat('a.txt', (e, st) => fin('stat')(e, st && st.size));
    });
    const ticking = async (name, loop) => {
      let ticks = 0;
      const t = setInterval(() => { ticks++; }, 0);
      const r = await loop();
      clearInterval(t);
      console.log(name + ' => ' + r + ' ticks>0=' + (ticks > 0));
    };
    const cbReads = () => new Promise((done, fail) => fs.open('big.bin', 'r', (e, fd) => {
      if (e) return fail(e);
      const buf = Buffer.alloc(65536);
      let total = 0;
      const step = () => fs.read(fd, buf, 0, 65536, null, (e2, n) => {
        if (e2) return fail(e2);
        if (n === 0) return fs.close(fd, () => done('bytes=' + total));
        total += n;
        step();
      });
      step();
    }));
    const moment = async () => {
      const later = { sync: (f) => f(), microtask: (f) => Promise.resolve().then(f), immediate: (f) => setImmediate(f) };
      const writers = [
        ['writeFile', ['sync', 'microtask'], (u8) => new Promise((r) => fs.writeFile('m2.bin', u8, () => r('m2.bin')))],
        ['promises.writeFile', ['sync', 'microtask'], (u8) => fs.promises.writeFile('m3.bin', u8).then(() => 'm3.bin')],
      ];
      for (const [name, whens, write] of writers) for (const when of whens) {
        const u8 = new Uint8Array([1, 2, 3]);
        const done = write(u8);
        later[when](() => u8.fill(9));
        const file = await done;
        console.log(name + ' then fill(9) [' + when + '] => ' + [...fs.readFileSync(file)].join(','));
      }
    };
    (async () => {
      for (const op of ops) await probe(op);
      await moment();
      await interleaved();
      await ticking('256 callback reads of 64 KiB', cbReads);
      await ticking('256 fs.promises.stat', async () => { for (let i = 0; i < 256; i++) await fs.promises.stat('a.txt'); return 'done'; });
      await ticking('256 fs.promises.readFile', async () => { let n = 0; for (let i = 0; i < 256; i++) n += (await fs.promises.readFile('a.txt')).length; return 'bytes=' + n; });
      fs.closeSync(fdR);
      fs.closeSync(fdW);
    })();
  `,
};

export default c;
