import type { ParityCase } from '../../src/types.ts';

/**
 * `fs.createReadStream` reading a file (backlog distribution/isolate-guest-fs-createreadstream-readablestream):
 * event order, `highWaterMark` slicing, `start`/`end`, `encoding`, empty/missing/directory
 * targets, a delete during the read. Rows run one after another, listeners attached
 * synchronously. Self-seeding: the isolate-host corpus runs the same code under `node -e`.
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { setTimeout: sleep } = require('node:timers/promises');
    const show = (c) => (typeof c === 'string' ? JSON.stringify(c) : 'B' + c.length + ':' + c.toString('latin1'));
    const row = async (label, path, opts, extra) => {
      const ev = [];
      const s = fs.createReadStream(path, opts);
      s.on('open', (fd) => ev.push('open:' + typeof fd));
      s.on('ready', () => ev.push('ready'));
      s.on('data', (c) => ev.push('data ' + show(c)));
      s.on('end', () => ev.push('end'));
      s.on('error', (e) => ev.push('error:' + e.code + ':' + e.syscall));
      const closed = new Promise((r) => s.on('close', () => { ev.push('close'); r(); }));
      if (extra) extra(s, ev);
      await closed;
      await sleep(5);
      console.log(label + ': ' + ev.join(' | '));
    };
    (async () => {
      fs.writeFileSync('rs-a.txt', 'abcdefghijklmnopqrstuvwxy');
      fs.writeFileSync('rs-empty.txt', '');
      fs.writeFileSync('rs-u.txt', 'aé€😀z');
      await row('hwm10', 'rs-a.txt', { highWaterMark: 10 });
      await row('default-hwm', 'rs-a.txt');
      await row('range', 'rs-a.txt', { start: 3, end: 12, highWaterMark: 4 });
      await row('start-only', 'rs-a.txt', { start: 20, highWaterMark: 4 });
      await row('end-only', 'rs-a.txt', { end: 5, highWaterMark: 4 });
      await row('start-eq-end', 'rs-a.txt', { start: 7, end: 7 });
      await row('start-past-eof', 'rs-a.txt', { start: 100 });
      await row('end-past-eof', 'rs-a.txt', { start: 22, end: 1000 });
      await row('utf8-split', 'rs-u.txt', { encoding: 'utf8', highWaterMark: 2 });
      await row('hex', 'rs-a.txt', { encoding: 'hex', highWaterMark: 7 });
      await row('base64-split', 'rs-a.txt', { encoding: 'base64', highWaterMark: 4 });
      await row('latin1-string-option', 'rs-a.txt', 'latin1');
      await row('empty', 'rs-empty.txt');
      await row('empty-hwm1', 'rs-empty.txt', { highWaterMark: 1 });
      await row('missing', 'rs-missing.txt');
      await row('missing-parent', 'rs-nodir/x.txt');
      await row('directory', '.');
      fs.writeFileSync('rs-m.txt', 'abcdefghij');
      await row('unlink-in-data', 'rs-m.txt', { highWaterMark: 4 }, (s, ev) => {
        let n = 0;
        s.on('data', () => {
          if (++n === 1) { fs.unlinkSync('rs-m.txt'); ev.push('exists=' + fs.existsSync('rs-m.txt')); }
        });
      });
      fs.writeFileSync('rs-m.txt', 'abcdefghij');
      await row('rewrite-sync-after-create', 'rs-m.txt', { highWaterMark: 4 }, () => fs.writeFileSync('rs-m.txt', 'NEW'));
      await row('unlink-sync-after-create', 'rs-m.txt', {}, () => fs.unlinkSync('rs-m.txt'));
      console.log('done');
    })();
  `,
};

export default c;
