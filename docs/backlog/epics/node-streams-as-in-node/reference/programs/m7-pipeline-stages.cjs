// pipeline/compose stages that are functions or async generators, and the success-callback arguments
// of pipeline/finished (lib/internal/streams/pipeline.js, end-of-stream.js).
const { Readable, Writable, PassThrough, Transform, pipeline, finished } = require('node:stream');
const sp = require('node:stream/promises');
const e2s = (e) =>
  e ? `${e.code ? `${e.code}:` : ''}${String(e.message).split('\n')[0].slice(0, 60)}` : String(e);
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const sink = (L) =>
  new Writable({
    write(c, _e, cb) {
      L.push(`w ${c}`);
      cb();
    },
  });
const upper = async function* (src) {
  for await (const c of src) yield String(c).toUpperCase();
};
row('promises.pipeline(Readable, async gen, Writable)', async (L) => {
  await sp.pipeline(Readable.from(['a', 'b']), upper, sink(L));
  L.push('resolved');
});
row('promises.pipeline(async gen source, Writable)', async (L) => {
  await sp.pipeline(async function* () {
    yield 'q';
  }, sink(L));
  L.push('resolved');
});
row('promises.pipeline(Readable, async fn sink) returns value', async (L) => {
  const v = await sp.pipeline(Readable.from(['x', 'y']), async (src) => {
    let t = '';
    for await (const c of src) t += c;
    return t;
  });
  L.push(`value ${v}`);
});
row('callback pipeline(Readable, async gen, Writable)', async (L) => {
  await new Promise((res) =>
    pipeline(Readable.from(['c']), upper, sink(L), (...a) => {
      L.push(
        `cb args=${a.length} ${a.map((x) => (x === undefined ? 'undef' : x === null ? 'null' : e2s(x))).join(' ')}`,
      );
      res();
    }),
  );
});
row('async gen stage throws: error reaches callback', async (L) => {
  await new Promise((res) =>
    pipeline(
      Readable.from(['c']),
      // biome-ignore lint/correctness/useYield: the stage throws before it yields
      async function* (s) {
        for await (const _c of s) throw new Error('gen boom');
      },
      sink(L),
      (e) => {
        L.push(`cb ${e2s(e)}`);
        res();
      },
    ),
  );
});
row('pipeline(Readable, PassThrough, Writable) success cb args', async (L) => {
  await new Promise((res) =>
    pipeline(Readable.from(['z']), new PassThrough(), sink(L), (...a) => {
      L.push(
        `cb args=${a.length} ${a.map((x) => (x === undefined ? 'undef' : x === null ? 'null' : 'obj')).join(' ')}`,
      );
      res();
    }),
  );
});
row('finished(readable) success cb args', async (L) => {
  const r = Readable.from(['b']);
  await new Promise((res) => {
    finished(r, (...a) => {
      L.push(`cb args=${a.length}`);
      res();
    });
    r.resume();
  });
});
row('finished on a Writable destroyed before any write', async (L) => {
  const w = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
  finished(w, (...a) => L.push(`cb args=${a.length} ${a[0] ? e2s(a[0]) : ''}`));
  w.destroy();
});
row('finished on a Readable destroyed before end', async (L) => {
  const r = new Readable({ read() {} });
  finished(r, (...a) => L.push(`cb args=${a.length} ${a[0] ? e2s(a[0]) : ''}`));
  r.destroy();
});
row('finished on a Transform destroyed after a write', async (L) => {
  const t = new Transform({
    transform(c, _e, cb) {
      cb(null, c);
    },
  });
  finished(t, (...a) => L.push(`cb args=${a.length} ${a[0] ? e2s(a[0]) : ''}`));
  t.write('a', () => t.destroy());
});
row('close(cb)-shape (finished + destroy) on a Transform that already errored', async (L) => {
  const t = new Transform({
    transform(_c, _e, cb) {
      cb(new Error('tfail'));
    },
  });
  t.on('error', () => {});
  t.write('a');
  await settle(5);
  finished(t, (...a) => L.push(`cb args=${a.length} ${a[0] ? e2s(a[0]) : ''}`));
  t.destroy();
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
