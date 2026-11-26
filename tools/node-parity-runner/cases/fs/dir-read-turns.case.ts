import type { ParityCase } from '../../src/types.ts';

/**
 * `fs.Dir` as Node's `lib/internal/fs/dir.js`: one I/O request per batch of `bufferSize`
 * entries (32), a read the buffer answers on `process.nextTick`, a call made while a request
 * is in flight queued behind it; the closed-handle errors. No promise is printed beside a
 * tick (the in-process runner's tick-vs-promise artifact). Node v24.16.0 240/240 under load (16 parallel).
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { setImmediate, setTimeout } = require('node:timers');
    const { nextTick } = require('node:process');
    fs.mkdirSync('d', { recursive: true });
    for (let i = 0; i < 40; i++) fs.writeFileSync('d/f' + String(i).padStart(2, '0'), '');
    const rows = [];
    const row = (name, run) => rows.push(() => new Promise((done) => run((line) => { console.log(name + ' => ' + line); done(); })));
    row('a read inside the first read callback', (out) => {
      const dir = fs.opendirSync('d');
      const log = [];
      dir.read(() => {
        log.push('read1');
        setImmediate(() => log.push('immediate'));
        dir.read(() => log.push('read2'));
        nextTick(() => log.push('tick'));
        setTimeout(() => { dir.closeSync(); out(log.join(' ')); }, 20);
      });
    });
    row('40 callback reads with an immediate spinning: reads an immediate came before', (out) => {
      const dir = fs.opendirSync('d');
      let spins = 0;
      let stop = false;
      const spin = () => { if (!stop) { spins++; setImmediate(spin); } };
      setImmediate(spin);
      const after = [];
      let n = 0;
      let last = 0;
      const step = () => dir.read((e, d) => {
        n++;
        if (spins !== last) after.push(n);
        last = spins;
        if (d) return step();
        stop = true;
        // In the last callback its request is still in flight: closeSync would be ERR_DIR_CONCURRENT_OPERATION.
        setImmediate(() => dir.closeSync());
        // The first read races the spinner's first turn in Node (239/240): from the second on.
        out(after.filter((k) => k > 1).join(','));
      });
      step();
    });
    row('for await over 40 entries', (out) => {
      (async () => {
        let n = 0;
        for await (const entry of fs.opendirSync('d')) n++;
        out('n=' + n);
      })();
    });
    row('closed handle', (out) => {
      const dir = fs.opendirSync('d');
      dir.closeSync();
      const log = [];
      try { dir.read(() => log.push('cb')); } catch (e) { log.push('read(cb) throws ' + e.code); }
      dir.close((e) => log.push('close(cb) ' + (e && e.code)));
      setImmediate(() => log.push('immediate'));
      try { dir.closeSync(); } catch (e) { log.push('closeSync throws ' + e.code); }
      setTimeout(() => {
        dir.read().then(() => log.push('read() resolved'), (e) => log.push('read() rejects ' + e.code)).then(() => out(log.join(', ')));
      }, 20);
    });
    row('a read queued behind a close while a read is in flight', (out) => {
      const dir = fs.opendirSync('d');
      const log = [];
      dir.read(() => log.push('read1'));
      dir.close((e) => log.push('close ' + (e && e.code)));
      dir.read((e, d) => log.push('read2 ' + (e && e.code) + ' ' + (d && d.name)));
      setTimeout(() => out(log.join(', ')), 30);
    });
    (async () => { for (const run of rows) await run(); })();
  `,
};

export default c;
