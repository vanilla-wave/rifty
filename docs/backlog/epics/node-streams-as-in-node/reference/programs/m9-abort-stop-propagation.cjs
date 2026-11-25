// S1: a guest listener that stops immediate propagation on 'abort' must not hide the abort from the
// stream core (Node's internal listener resists it: kResistStopPropagation).
const { Readable, Writable, finished, addAbortSignal } = require('node:stream');
const sp = require('node:stream/promises');
const e2s = (e) => (e ? `${e.code || e.name}` : 'none');
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const stopper = (ac) => ac.signal.addEventListener('abort', (e) => e.stopImmediatePropagation());
row('promises.pipeline(r, w, {signal}), abort after a stopping listener', async (L) => {
  const ac = new AbortController();
  stopper(ac);
  const r = new Readable({ read() {} });
  const w = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
  const p = sp.pipeline(r, w, { signal: ac.signal }).then(
    () => 'resolved',
    (e) => e2s(e),
  );
  setTimeout(() => ac.abort(), 5);
  L.push(
    await Promise.race([p, settle(500).then(() => 'pending')]),
    `destroyed=${r.destroyed}/${w.destroyed}`,
  );
});
row('finished(r, {signal}) after a stopping listener', async (L) => {
  const ac = new AbortController();
  stopper(ac);
  const r = new Readable({ read() {} });
  const p = new Promise((res) => finished(r, { signal: ac.signal }, (e) => res(e2s(e))));
  setTimeout(() => ac.abort(), 5);
  L.push(await Promise.race([p, settle(500).then(() => 'pending')]));
});
row('addAbortSignal(signal, r) after a stopping listener', async (L) => {
  const ac = new AbortController();
  stopper(ac);
  const r = addAbortSignal(ac.signal, new Readable({ read() {} }));
  r.on('error', (e) => L.push(`error ${e2s(e)}`));
  ac.abort();
  await settle(20);
  L.push(`destroyed=${r.destroyed}`);
});
row('Readable.from(gen).map(fn, {signal}) after a stopping listener', async (L) => {
  const ac = new AbortController();
  stopper(ac);
  const it = Readable.from(
    (async function* () {
      for (;;) {
        yield 1;
        await settle(5);
      }
    })(),
  ).map((x) => x, { signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  const p = row(
    'Readable.reduce(fn, init, {signal}) after a stopping listener (operators.js direct listener)',
    async (L) => {
      const ac = new AbortController();
      stopper(ac);
      const src = Readable.from(
        (async function* () {
          for (;;) {
            yield 1;
            await settle(5);
          }
        })(),
      );
      const p = src
        .reduce((a, x) => a + x, 0, { signal: ac.signal })
        .then(
          () => 'resolved',
          (e) => e2s(e),
        );
      setTimeout(() => ac.abort(), 20);
      L.push(await Promise.race([p, settle(500).then(() => 'pending')]));
    },
  );
  (async () => {
    try {
      for await (const _ of it);
      return 'ended';
    } catch (e) {
      return e2s(e);
    }
  })();
  L.push(await Promise.race([p, settle(500).then(() => 'pending')]));
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
  // A row left pending keeps a generator alive; end the run here.
  process.exit(0);
})();
let uncaught = 0;
process.on('uncaughtException', (e) => console.log(`uncaught ${++uncaught} => ${e2s(e)}`));
