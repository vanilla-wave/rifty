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
    const rows = [];
    const runOne = async (label, opts, fn, path) => {
      const ev = [];
      const s = fs.createReadStream(path || 'rsc.txt', opts);
      for (const n of ['open', 'ready', 'end', 'error', 'close']) {
        s.on(n, (a) => ev.push(n + (a && a.code ? ':' + a.code : '')));
      }
      // noClosed: Node's 'closed' flips after its async fs.close, rifty's in the 'end' tick —
      // declared in backlog runtime-js/fs-streams-not-node-streams, not printed there.
      const cb = (t, noClosed) => function (...args) {
        const state = noClosed ? 'destroyed=' + s.destroyed : st(s);
        ev.push(t + '(' + args.length + ':' + args.map(tag).join(',') + ') this=' + (this === s) + ' ' + state);
      };
      await fn(s, cb, ev);
      await sleep(50);
      return label + ': ' + ev.join(' | ') + ' || ' + st(s);
    };
    const run = (...args) => rows.push(runOne(...args));
    run('preopen', {}, (s, cb) => { s.close(cb('cb')); });
    run('preopen-nocb', {}, (s) => { s.close(); });
    run('after-ready', {}, async (s, cb) => { await ready(s); s.close(cb('cb')); });
    run('in-open', {}, (s, cb) => { s.on('open', () => s.close(cb('cb'))); });
    run('after-destroy', {}, async (s, cb) => { await ready(s); s.destroy(); s.close(cb('cb')); });
    run('mid-data', { highWaterMark: 10 }, (s, cb, ev) => {
      let n = 0;
      s.on('data', () => { ev.push('data'); if (++n === 2) s.close(cb('cb')); });
    });
    run('after-close', {}, async (s, cb) => {
      s.on('data', () => {});
      await new Promise((r) => s.on('close', r));
      s.close(cb('cb'));
    });
    run('in-end', {}, (s, cb) => { s.on('data', () => {}); s.on('end', () => s.close(cb('cb'))); });
    run('twice', {}, async (s, cb) => { await ready(s); s.close(cb('cb1')); s.close(cb('cb2')); });
    // A flowing stream ('data' listener) closed/destroyed around the first read: no 'data'
    // or 'end' after the request (async openReadable read in flight, review 2026-11-24).
    const flowing = (when, method) => (s, cb, ev) => {
      const stop = () => { ev.push('request'); if (method === 'close') s.close(cb('cb')); else s.destroy(); };
      s.on('data', (c) => { ev.push('data:' + c.length); if (when === 'after-data-micro') queueMicrotask(stop); });
      if (when === 'in-ready') s.on('ready', stop);
      if (when === 'micro-ready') s.on('ready', () => queueMicrotask(stop));
      if (when === 'after-ready') return ready(s).then(stop);
    };
    for (const when of ['in-ready', 'after-ready', 'micro-ready', 'after-data-micro']) {
      run('flowing-close-' + when, {}, flowing(when, 'close'));
      run('flowing-destroy-' + when, {}, flowing(when, 'destroy'));
    }
    run('twice-preopen', {}, (s, cb) => { s.close(cb('cb1')); s.close(cb('cb2')); });
    run('twice-after-close', {}, async (s, cb) => {
      s.on('data', () => {});
      await new Promise((r) => s.on('close', r));
      s.close(cb('cb1'));
      s.close(cb('cb2'));
    });
    run('missing', {}, (s, cb) => { s.close(cb('cb')); }, 'missing.txt');
    run('missing-nocb', {}, (s) => { s.close(); }, 'missing.txt');
    run('missing-in-error', {}, (s, cb) => { s.on('error', () => s.close(cb('cb'))); }, 'missing.txt');
    run('missing-after-close', {}, async (s, cb) => {
      await new Promise((r) => s.on('close', r));
      s.close(cb('cb'));
    }, 'missing.txt');
    run('directory-in-open', {}, (s, cb) => { s.on('open', () => s.close(cb('cb'))); }, '.');
    run('directory-after-ready', {}, async (s, cb) => { await ready(s); s.close(cb('cb')); }, '.');
    run('emitclose-false', { emitClose: false }, async (s, cb) => { await ready(s); s.close(cb('cb')); });
    // Twice with emitClose:false: the second cb settles a tick later, no arguments (Node's onclosed).
    run('emitclose-false-twice-after-ready', { emitClose: false }, async (s, cb) => {
      await ready(s);
      s.close(cb('cb1', true));
      s.close(cb('cb2', true));
    });
    run('emitclose-false-twice-in-ready', { emitClose: false }, (s, cb) => {
      s.on('ready', () => { s.close(cb('cb1', true)); s.close(cb('cb2', true)); });
    });
    run('emitclose-false-after-end', { emitClose: false }, async (s, cb) => {
      s.on('data', () => {});
      await new Promise((r) => s.on('end', r));
      s.close(cb('cb', true));
    });
    run('emitclose-false-in-end', { emitClose: false }, (s, cb) => {
      s.on('data', () => {});
      s.on('end', () => s.close(cb('cb', true)));
    });
    run('emitclose-false-missing', { emitClose: false }, (s, cb) => { s.close(cb('cb')); }, 'missing.txt');
    run('emitclose-false-missing-in-error', { emitClose: false }, (s, cb) => {
      s.on('error', () => s.close(cb('cb')));
    }, 'missing.txt');
    run('return-and-sync-state', {}, async (s, cb, ev) => {
      ev.push('pre ' + st(s));
      await ready(s);
      ev.push('ret=' + s.close());
      ev.push('sync ' + st(s));
    });
    run('non-function-arg', {}, (s, cb, ev) => {
      try { s.close('notfn'); ev.push('no-throw'); } catch (e) { ev.push('throw ' + e.code); }
    });
    run('state-in-end', {}, (s, cb, ev) => {
      s.on('data', () => {});
      s.on('end', () => ev.push('in-end ' + st(s)));
    });
    run('state-in-error', {}, (s, cb, ev) => { s.on('error', () => ev.push('in-error ' + st(s))); }, 'missing.txt');
    Promise.all(rows).then((lines) => {
      for (const l of lines) console.log(l);
      console.log('proto close: ' + typeof fs.ReadStream.prototype.close + ' destroySoon: ' + typeof fs.ReadStream.prototype.destroySoon);
    });
  `,
};

export default c;
