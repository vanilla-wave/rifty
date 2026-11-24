import type { ParityCase } from '../../src/types.ts';

/**
 * `fs.WriteStream#close([cb])` + `destroySoon` (backlog
 * runtime-js/fs-stream-close-method-missing): Node = `cb` truthy → `closed` ? nextTick(cb) :
 * `on('close', cb)`; then `end()`; `destroySoon === end`. Per row: event order, callback
 * arguments and `this`, `closed`/`destroyed`, file content. Self-seeding (no setup files) so
 * the isolate-host corpus runs the same code under `node -e`.
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { setTimeout: sleep } = require('node:timers/promises');
    fs.writeFileSync('wsc-seed.txt', 'seed');
    const tag = (e) => (e ? e.code || e.name || String(e) : 'none');
    const st = (s) => 'closed=' + s.closed + ' destroyed=' + s.destroyed;
    const ready = (s) => new Promise((r) => s.once('ready', r));
    const rows = [];
    const runOne = async (label, opts, fn, path) => {
      const ev = [];
      const file = path || 'wsc-' + label + '.out';
      const s = fs.createWriteStream(file, opts);
      for (const n of ['open', 'ready', 'finish', 'drain', 'error', 'close']) {
        s.on(n, (a) => ev.push(n + (a && a.code ? ':' + a.code : '')));
      }
      const cb = (t) => function (...args) {
        ev.push(t + '(' + args.length + ':' + args.map(tag).join(',') + ') this=' + (this === s) + ' ' + st(s));
      };
      await fn(s, cb, ev);
      await sleep(50);
      let content;
      try { content = JSON.stringify(fs.readFileSync(file, 'utf8')); } catch (e) { content = e.code; }
      return label + ': ' + ev.join(' | ') + ' || ' + st(s) + ' file=' + content;
    };
    const run = (...args) => rows.push(runOne(...args));
    run('preopen-write', {}, (s, cb) => { s.write('data', cb('wcb')); s.close(cb('cb')); });
    run('preopen-empty', {}, (s, cb) => { s.close(cb('cb')); });
    run('after-ready-write', {}, async (s, cb) => { await ready(s); s.write('data', cb('wcb')); s.close(cb('cb')); });
    run('in-ready-write', {}, (s, cb) => { s.on('ready', () => { s.write('data', cb('wcb')); s.close(cb('cb')); }); });
    run('no-cb', {}, (s) => { s.write('x'); s.close(); });
    run('twice', {}, (s, cb) => { s.write('x'); s.close(cb('cb1')); s.close(cb('cb2')); });
    run('twice-after-close', {}, async (s, cb) => {
      s.write('x');
      s.close(cb('cb1'));
      await new Promise((r) => s.on('close', r));
      s.close(cb('cb2'));
    });
    run('after-end', {}, (s, cb) => { s.end('x', cb('ecb')); s.close(cb('cb')); });
    run('in-finish', {}, (s, cb) => { s.on('finish', () => s.close(cb('cb'))); s.end('x'); });
    run('write-after-close', {}, (s, cb) => { s.close(cb('cb')); s.write('y', cb('wcb')); });
    run('eisdir', {}, (s, cb) => { s.close(cb('cb')); }, '.');
    run('eexist', { flags: 'wx' }, (s, cb) => { s.close(cb('cb')); }, 'wsc-seed.txt');
    run('eexist-in-error', { flags: 'wx' }, (s, cb) => { s.on('error', () => s.close(cb('cb'))); }, 'wsc-seed.txt');
    run('eexist-after-close', { flags: 'wx' }, async (s, cb) => {
      await new Promise((r) => s.on('close', r));
      s.close(cb('cb'));
    }, 'wsc-seed.txt');
    run('emitclose-false', { emitClose: false }, (s, cb) => { s.write('x'); s.close(cb('cb')); });
    run('emitclose-false-after-finish', { emitClose: false }, async (s, cb) => {
      s.end('x');
      await new Promise((r) => s.on('finish', r));
      await sleep(10); // past Node's async fs.close: closed=true
      s.close(cb('cb'));
    });
    run('after-destroy', {}, async (s, cb) => { await ready(s); s.destroy(); s.close(cb('cb')); });
    run('destroy-after-close', {}, (s, cb) => { s.write('x'); s.close(cb('cb')); s.destroy(); });
    run('high-water-mark', { highWaterMark: 2 }, (s, cb, ev) => {
      ev.push('write=' + s.write('abcdef'));
      s.close(cb('cb'));
    });
    run('return-and-sync-state', {}, async (s, cb, ev) => {
      ev.push('pre ' + st(s));
      await ready(s);
      ev.push('ret=' + s.close());
      ev.push('sync ' + st(s));
    });
    run('state-in-finish', {}, (s, cb, ev) => { s.on('finish', () => ev.push('in-finish ' + st(s))); s.end('x'); });
    run('state-in-error', { flags: 'wx' }, (s, cb, ev) => { s.on('error', () => ev.push('in-error ' + st(s))); }, 'wsc-seed.txt');
    run('destroySoon', {}, (s, cb, ev) => { s.write('x'); ev.push('ret-is-stream=' + (s.destroySoon(cb('dcb')) === s)); });
    run('destroySoon-chunk', {}, (s, cb) => { s.destroySoon('zz', cb('dcb')); });
    run('destroySoon-after-close', {}, async (s, cb) => {
      s.destroySoon();
      await new Promise((r) => s.on('close', r));
      s.destroySoon(cb('dcb'));
    });
    Promise.all(rows).then((lines) => {
      for (const l of lines) console.log(l);
      console.log('destroySoon === end: ' + (fs.WriteStream.prototype.destroySoon === fs.WriteStream.prototype.end) + ' close: ' + typeof fs.WriteStream.prototype.close);
    });
  `,
};

export default c;
