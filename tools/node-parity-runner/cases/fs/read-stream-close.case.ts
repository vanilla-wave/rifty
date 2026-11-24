import type { ParityCase } from '../../src/types.ts';

/**
 * `fs.ReadStream#close([cb])` (backlog runtime-js/fs-stream-close-method-missing): Node =
 * `finished(this, cb)` + `destroy()`. Per row: event order, the callback's arguments and
 * `this`, `closed`/`destroyed` in the callback and after settle. Self-seeding (no setup
 * files) so the isolate-host corpus runs the same code under `node -e`.
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { setTimeout: sleep } = require('node:timers/promises');
    fs.writeFileSync('rsc.txt', 'abcdefghij'.repeat(10));
    const tag = (e) => (e ? e.code || e.name || String(e) : 'none');
    const st = (s) => 'closed=' + s.closed + ' destroyed=' + s.destroyed;
    const ready = (s) => new Promise((r) => s.once('ready', r));
    const run = async (label, opts, fn, path) => {
      const ev = [];
      const s = fs.createReadStream(path || 'rsc.txt', opts);
      for (const n of ['open', 'ready', 'end', 'error', 'close']) {
        s.on(n, (a) => ev.push(n + (a && a.code ? ':' + a.code : '')));
      }
      const cb = (t) => function (...args) {
        ev.push(t + '(' + args.length + ':' + args.map(tag).join(',') + ') this=' + (this === s) + ' ' + st(s));
      };
      await fn(s, cb, ev);
      await sleep(50);
      console.log(label + ': ' + ev.join(' | ') + ' || ' + st(s));
    };
    (async () => {
      await run('preopen', {}, (s, cb) => { s.close(cb('cb')); });
      await run('preopen-nocb', {}, (s) => { s.close(); });
      await run('after-ready', {}, async (s, cb) => { await ready(s); s.close(cb('cb')); });
      await run('in-open', {}, (s, cb) => { s.on('open', () => s.close(cb('cb'))); });
      await run('after-destroy', {}, async (s, cb) => { await ready(s); s.destroy(); s.close(cb('cb')); });
      await run('mid-data', { highWaterMark: 10 }, (s, cb, ev) => {
        let n = 0;
        s.on('data', () => { ev.push('data'); if (++n === 2) s.close(cb('cb')); });
      });
      await run('after-close', {}, async (s, cb) => {
        s.on('data', () => {});
        await new Promise((r) => s.on('close', r));
        s.close(cb('cb'));
      });
      await run('in-end', {}, (s, cb) => { s.on('data', () => {}); s.on('end', () => s.close(cb('cb'))); });
      await run('twice', {}, async (s, cb) => { await ready(s); s.close(cb('cb1')); s.close(cb('cb2')); });
      await run('twice-preopen', {}, (s, cb) => { s.close(cb('cb1')); s.close(cb('cb2')); });
      await run('twice-after-close', {}, async (s, cb) => {
        s.on('data', () => {});
        await new Promise((r) => s.on('close', r));
        s.close(cb('cb1'));
        s.close(cb('cb2'));
      });
      await run('missing', {}, (s, cb) => { s.close(cb('cb')); }, 'missing.txt');
      await run('missing-nocb', {}, (s) => { s.close(); }, 'missing.txt');
      await run('missing-in-error', {}, (s, cb) => { s.on('error', () => s.close(cb('cb'))); }, 'missing.txt');
      await run('missing-after-close', {}, async (s, cb) => {
        await new Promise((r) => s.on('close', r));
        s.close(cb('cb'));
      }, 'missing.txt');
      await run('directory-in-open', {}, (s, cb) => { s.on('open', () => s.close(cb('cb'))); }, '.');
      await run('emitclose-false', { emitClose: false }, async (s, cb) => { await ready(s); s.close(cb('cb')); });
      await run('emitclose-false-after-end', { emitClose: false }, async (s, cb) => {
        s.on('data', () => {});
        await new Promise((r) => s.on('end', r));
        s.close(cb('cb'));
      });
      await run('emitclose-false-in-end', { emitClose: false }, (s, cb) => {
        s.on('data', () => {});
        s.on('end', () => s.close(cb('cb')));
      });
      await run('emitclose-false-missing', { emitClose: false }, (s, cb) => { s.close(cb('cb')); }, 'missing.txt');
      await run('emitclose-false-missing-in-error', { emitClose: false }, (s, cb) => {
        s.on('error', () => s.close(cb('cb')));
      }, 'missing.txt');
      await run('return-and-sync-state', {}, async (s, cb, ev) => {
        ev.push('pre ' + st(s));
        await ready(s);
        ev.push('ret=' + s.close());
        ev.push('sync ' + st(s));
      });
      await run('non-function-arg', {}, (s, cb, ev) => {
        try { s.close('notfn'); ev.push('no-throw'); } catch (e) { ev.push('throw ' + e.code); }
      });
      await run('state-in-end', {}, (s, cb, ev) => {
        s.on('data', () => {});
        s.on('end', () => ev.push('in-end ' + st(s)));
      });
      await run('state-in-error', {}, (s, cb, ev) => { s.on('error', () => ev.push('in-error ' + st(s))); }, 'missing.txt');
      console.log('proto close: ' + typeof fs.ReadStream.prototype.close + ' destroySoon: ' + typeof fs.ReadStream.prototype.destroySoon);
    })();
  `,
};

export default c;
