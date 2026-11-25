// Lifecycle rows: hook callback once (ERR_MULTIPLE_CALLBACK), destroy moment, errored, autoDestroy
// 'close' after 'end', and the two
// Transform paths node:zlib takes (lib/zlib.js zlibBuffer + ZlibBase.close/_destroy, zlibOnError).
const { Readable, Writable, Duplex, Transform, finished } = require('node:stream');
// matrix.cjs of runtime-js/stream-destroy-construct-hooks is the hook-by-way matrix; run.mjs runs it too.
const e2s = (e) =>
  e ? `${e.code ? `${e.code}:` : ''}${String(e.message).split('\n')[0].slice(0, 60)}` : String(e);
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const watch = (s, L, evs = ['error', 'prefinish', 'finish', 'end', 'close']) => {
  for (const ev of evs) s.on(ev, (x) => L.push(ev === 'error' ? `error ${e2s(x)}` : ev));
};
row('Writable _write cb twice', async (L) => {
  const w = new Writable({
    write(_c, _e, cb) {
      cb();
      cb();
    },
  });
  watch(w, L);
  w.write('a');
});
row('Writable _final cb twice', async (L) => {
  const w = new Writable({
    write(_c, _e, cb) {
      cb();
    },
    final(cb) {
      cb();
      cb();
    },
  });
  watch(w, L);
  w.end('a');
});
row('Transform _transform cb twice', async (L) => {
  const t = new Transform({
    transform(_c, _e, cb) {
      cb(null, 'x');
      cb(null, 'y');
    },
  });
  watch(t, L);
  t.on('data', (d) => L.push(`data ${d}`));
  t.write('a');
});
row('Writable _construct cb twice', async (L) => {
  const w = new Writable({
    construct(cb) {
      cb();
      cb();
    },
    write(_c, _e, cb) {
      cb();
    },
  });
  watch(w, L);
});
row('Writable _destroy cb twice', async (L) => {
  const w = new Writable({
    write(_c, _e, cb) {
      cb();
    },
    destroy(err, cb) {
      L.push('_destroy');
      cb(err);
      cb(err);
    },
  });
  watch(w, L);
  w.destroy();
});
row('Readable destroy(err): sync destroyed/errored', async (L) => {
  const r = new Readable({ read() {} });
  watch(r, L);
  r.destroy(new Error('boom'));
  L.push(`sync destroyed=${r.destroyed} errored=${r.errored?.message}`);
});
row('Readable _destroy replaces error', async (L) => {
  const r = new Readable({
    read() {},
    destroy(err, cb) {
      L.push(`_destroy ${e2s(err)}`);
      cb(new Error('replaced'));
    },
  });
  watch(r, L);
  r.destroy(new Error('orig'));
});
row('Readable _construct before _read', async (L) => {
  const r = new Readable({
    construct(cb) {
      L.push('construct');
      setTimeout(() => {
        L.push('construct cb');
        cb();
      }, 5);
    },
    read() {
      L.push('read');
      this.push(null);
    },
  });
  watch(r, L);
  r.resume();
});
row('zlibBuffer shape: end(buf) -> data/end -> close() -> _destroy', async (L) => {
  class Z extends Transform {
    _transform(c, _e, cb) {
      cb(null, c);
    }
    _destroy(err, cb) {
      L.push(`_destroy ${e2s(err)}`);
      cb(err);
    }
    close(cb) {
      if (cb) finished(this, cb);
      this.destroy();
    }
  }
  const z = new Z({ autoDestroy: true });
  watch(z, L);
  z.on('data', (d) => L.push(`data ${d}`));
  z.on('end', () => z.close(() => L.push('close cb')));
  z.end(Buffer.from('ab'));
});
row('zlibOnError shape: destroy(err) inside _transform', async (L) => {
  class Z extends Transform {
    _transform(_c, _e, cb) {
      this.destroy(Object.assign(new Error('invalid'), { code: 'Z_DATA_ERROR' }));
      cb();
    }
    _destroy(err, cb) {
      L.push(`_destroy ${e2s(err)}`);
      cb(err);
    }
  }
  const z = new Z();
  watch(z, L);
  z.on('end', () => L.push('end'));
  z.end(Buffer.from('ab'));
});
row('Readable to end + Writable ended: close after end/finish', async (L) => {
  const r = new Readable({
    read() {
      this.push('a');
      this.push(null);
    },
  });
  const w = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
  r.on('end', () => L.push('R end')).on('close', () => L.push('R close'));
  w.on('finish', () => L.push('W finish')).on('close', () => L.push('W close'));
  r.resume();
  w.end('x');
});
row('closed/destroyed/errored after destroy(err), each class', async (L) => {
  const mk = {
    Readable: () => new Readable({ read() {} }),
    Writable: () =>
      new Writable({
        write(_c, _e, cb) {
          cb();
        },
      }),
    Duplex: () =>
      new Duplex({
        read() {},
        write(_c, _e, cb) {
          cb();
        },
      }),
    Transform: () =>
      new Transform({
        transform(c, _e, cb) {
          cb(null, c);
        },
      }),
  };
  const ss = Object.entries(mk).map(([k, f]) => [k, f()]);
  for (const [, s] of ss) {
    s.on('error', () => {});
    s.destroy(new Error('x'));
  }
  L.push(
    `sync ${ss.map(([k, s]) => `${k}:${s.closed}/${s.destroyed}/${s.errored?.message}`).join(' ')}`,
  );
  await settle(10);
  L.push(`later ${ss.map(([k, s]) => `${k}:${s.closed}/${s.destroyed}`).join(' ')}`);
});
row('async Transform success: destroyed at end/finish/close', async (L) => {
  const t = new Transform({
    transform(c, _e, cb) {
      setImmediate(() => cb(null, c));
    },
  });
  for (const ev of ['end', 'finish', 'close'])
    t.on(ev, () => L.push(`${ev} destroyed=${t.destroyed} closed=${t.closed}`));
  t.resume();
  t.end('a');
});
row('prototype _destroy is a function', async (L) => {
  L.push([Readable, Writable, Duplex, Transform].map((C) => typeof C.prototype._destroy).join(','));
});
(async () => {
  for (const [name, fn] of rows) {
    const L = [];
    try {
      await Promise.race([fn(L), settle(3000).then(() => L.push('no settle in 3s'))]);
    } catch (e) {
      L.push(`threw ${e2s(e)}`);
    }
    await settle();
    console.log(`${name} => ${L.join(',')}`);
  }
})();
let uncaught = 0;
process.on('uncaughtException', (e) => console.log(`uncaught ${++uncaught} => ${e2s(e)}`));
