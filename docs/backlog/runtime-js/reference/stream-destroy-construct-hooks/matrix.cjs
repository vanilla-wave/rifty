// node matrix.cjs — _destroy/_construct × class × way, one line per scenario.
const stream = require('node:stream');
const util = require('node:util');
const { Readable, Writable, Duplex, Transform, PassThrough } = stream;
const WAYS = ['option', 'own', 'class', 'es5', 'chain', 'late'];
const e2s = (e) => (e ? (e.code ? `${e.code}:` : '') + e.message : String(e));
function make(Base, hooks, way, opts = {}) {
  if (way === 'option') {
    const o = { ...opts };
    for (const [k, f] of Object.entries(hooks)) o[k.slice(1)] = f;
    return new Base(o);
  }
  if (way === 'own') {
    const s = new Base(opts);
    Object.assign(s, hooks);
    return s;
  }
  if (way === 'class') {
    class X extends Base {}
    Object.assign(X.prototype, hooks);
    return new X(opts);
  }
  if (way === 'es5') {
    const X = function X(o) {
      if (!(this instanceof X)) return new X(o);
      Base.call(this, o);
    };
    util.inherits(X, Base);
    Object.assign(X.prototype, hooks);
    return new X(opts);
  }
  if (way === 'chain') {
    class A extends Base {}
    Object.assign(A.prototype, hooks);
    class B extends A {}
    return new B(opts);
  }
  if (way === 'late') {
    class X extends Base {}
    const s = new X(opts);
    Object.assign(X.prototype, hooks);
    return s;
  }
  throw new Error(`unknown way ${way}`);
}
const lines = [];
const report = [];
function scenario(name, body) {
  const l = [];
  let summary = () => l.join(',');
  try {
    const r = body(l);
    if (typeof r === 'function') summary = r;
  } catch (e) {
    l.push(`threw ${e2s(e)}`);
  }
  report.push(() => lines.push(`${name} => ${summary()}`));
}
function done(ms = 40) {
  setTimeout(() => {
    for (const f of report) f();
    for (const line of lines) console.log(line);
  }, ms);
}
const CLASSES = [Readable, Writable, Duplex, Transform, PassThrough];
const feed = (s) => {
  if (s instanceof Readable) s.on('data', () => {});
};
for (const way of WAYS) {
  for (const Base of CLASSES) {
    scenario(`${Base.name} ${way} _destroy replaces the error`, (l) => {
      const s = make(
        Base,
        {
          _read() {},
          _destroy(err, cb) {
            l.push(`D:${e2s(err)}:${this === s}`);
            cb(err && new Error('replaced'));
          },
        },
        way,
      );
      s.on('error', (e) => l.push(`error ${e.message}`));
      s.on('close', () => l.push('close'));
      s.destroy(new Error('boom'));
      l.push(`sync destroyed=${s.destroyed}`);
      s.destroy(new Error('again'));
    });
    scenario(`${Base.name} ${way} _construct gates work`, (l) => {
      const s = make(
        Base,
        {
          _construct(cb) {
            l.push(`C:${this === s}`);
            setTimeout(() => {
              l.push('Cdone');
              cb();
            }, 2);
          },
          _read() {
            l.push('R');
            this.push('r');
            this.push(null);
          },
          _write(c, _e, cb) {
            l.push(`W${c}`);
            cb();
          },
          _transform(c, _e, cb) {
            l.push(`T${c}`);
            cb(null, c);
          },
        },
        way,
      );
      s.on('error', (e) => l.push(`error ${e2s(e)}`));
      feed(s);
      if (Base !== Readable) s.end('x');
      l.push('sync');
      return () => {
        const i = l.indexOf('Cdone');
        return i < 0
          ? `never-constructed ops=${l
              .filter((x) => x !== 'sync')
              .sort()
              .join(',')}`
          : `pre=${l.slice(0, i).join(',')} post=${l
              .slice(i + 1)
              .sort()
              .join(',')}`;
      };
    });
  }
}
scenario('Writable _destroy() without error, callback ok', (l) => {
  const w = new Writable({
    write(_c, _e, cb) {
      cb();
    },
    destroy(err, cb) {
      l.push(`D ${e2s(err)}`);
      cb();
    },
  });
  w.on('error', (e) => l.push(`error ${e2s(e)}`));
  w.on('close', () => l.push('close'));
  w.destroy();
});
scenario('Writable _destroy() without error, callback error', (l) => {
  const w = new Writable({
    write(_c, _e, cb) {
      cb();
    },
    destroy(_err, cb) {
      cb(new Error('X'));
    },
  });
  w.on('error', (e) => l.push(`error ${e2s(e)}`));
  w.on('close', () => l.push('close'));
  w.destroy();
});
scenario('Writable async _destroy callback', (l) => {
  const w = new Writable({
    write(_c, _e, cb) {
      cb();
    },
    destroy(err, cb) {
      l.push('D');
      setTimeout(() => {
        l.push('Dcb');
        cb(err);
      }, 3);
    },
  });
  w.on('error', (e) => l.push(`error ${e2s(e)}`));
  w.on('close', () => l.push('close'));
  w.destroy(new Error('e'));
  l.push(`sync errored=${e2s(w.errored)}`);
  setTimeout(() => l.push('t1'), 1);
});
for (const Base of [Duplex, Transform]) {
  scenario(`${Base.name} _destroy runs once for both sides`, (l) => {
    const d = new Base({
      read() {},
      write(_c, _e, cb) {
        cb();
      },
      transform(_c, _e, cb) {
        cb();
      },
      destroy(err, cb) {
        l.push(`D ${e2s(err)}`);
        cb(err);
      },
    });
    d.on('error', (e) => l.push(`error ${e2s(e)}`));
    d.on('close', () => l.push('close'));
    d.destroy(new Error('e'));
  });
  scenario(`${Base.name} write error reaches _destroy`, (l) => {
    const d = new Base({
      read() {},
      write(_c, _e, cb) {
        cb(new Error('w'));
      },
      transform(_c, _e, cb) {
        cb(new Error('w'));
      },
      destroy(err, cb) {
        l.push(`D ${e2s(err)}`);
        cb(err);
      },
    });
    d.on('error', (e) => l.push(`error ${e2s(e)}`));
    d.write('x');
  });
}
for (const Base of [Readable, Writable, Duplex, Transform]) {
  scenario(`${Base.name} _construct error destroys`, (l) => {
    const s = new Base({
      read() {
        l.push('R');
      },
      write(_c, _e, cb) {
        l.push('W');
        cb();
      },
      transform(_c, _e, cb) {
        l.push('T');
        cb();
      },
      construct(cb) {
        l.push('C');
        setTimeout(() => cb(new Error('cfail')), 1);
      },
      destroy(err, cb) {
        l.push(`D ${e2s(err)}`);
        cb(err);
      },
    });
    s.on('error', (e) => l.push(`error ${e2s(e)}`));
    s.on('close', () => l.push('close'));
    feed(s);
    if (Base !== Readable) s.write('a');
  });
}
for (const Base of [Readable, Writable]) {
  scenario(`${Base.name} destroy during _construct`, (l) => {
    const s = new Base({
      read() {
        l.push('R');
      },
      write(_c, _e, cb) {
        l.push('W');
        cb();
      },
      construct(cb) {
        l.push('C');
        setTimeout(() => {
          l.push('Cdone');
          cb();
        }, 2);
      },
      destroy(err, cb) {
        l.push(`D ${e2s(err)}`);
        cb(err);
      },
    });
    s.on('error', (e) => l.push(`error ${e2s(e)}`));
    s.on('close', () => l.push('close'));
    if (Base === Writable) s.write('a', (e) => l.push(`wcb ${e2s(e)}`));
    s.destroy(new Error('early'));
  });
}
scenario('Writable sync _construct still defers to next tick', (l) => {
  const w = new Writable({
    construct(cb) {
      l.push('C');
      cb();
    },
    write(c, _e, cb) {
      l.push(`W${c}`);
      cb();
    },
    final(cb) {
      l.push('FIN');
      cb();
    },
  });
  w.write('a');
  w.end('b');
  l.push('sync');
});
scenario('Readable read() before _construct', (l) => {
  const r = new Readable({
    construct(cb) {
      setTimeout(() => {
        l.push('Cdone');
        cb();
      }, 2);
    },
    read() {
      l.push('R');
      this.push('x');
      this.push(null);
    },
  });
  l.push(`read=${r.read()}`);
  r.on('data', (c) => l.push(`d${c}`));
});
scenario(
  'prototype shape',
  () => () =>
    `${CLASSES.map((C) => `${C.name}:${typeof C.prototype._destroy}/${typeof C.prototype._construct}`).join(' ')} duplex-destroy-is-readable:${Duplex.prototype._destroy === Readable.prototype._destroy}`,
);
done(60);
