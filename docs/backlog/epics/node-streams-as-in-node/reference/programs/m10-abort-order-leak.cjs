// The stream core's abort listeners on a host signal: when they run relative to the guest's own, and
// whether they are released (Node's reduce listeners are weak, kWeakHandler: they stay counted until GC). Listener counts read with Node's own getEventListeners (this probe runs
// where `process.getBuiltinModule` is real Node's: Node and rifty in-process; elsewhere 'n/a').
const { Readable, Writable, finished } = require('node:stream');
const sp = require('node:stream/promises');
const e2s = (e) => (e ? `${e.code || e.name}` : 'none');
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const hostEvents =
  typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule('events') : null;
const count = (s) =>
  hostEvents?.getEventListeners ? hostEvents.getEventListeners(s, 'abort').length : 'n/a';
row('a guest abort listener added after pipeline sees the source destroyed', async (L) => {
  const ac = new AbortController();
  const r = new Readable({ read() {} });
  const w = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
  sp.pipeline(r, w, { signal: ac.signal }).catch(() => {});
  ac.signal.addEventListener('abort', () => L.push(`guest sees destroyed=${r.destroyed}`));
  ac.abort();
  await settle(20);
});
row('listeners left on the signal after 10000 completed reduce({signal})', async (L) => {
  const ac = new AbortController();
  for (let i = 0; i < 10000; i++)
    await Readable.from([1, 2]).reduce((a, x) => a + x, 0, { signal: ac.signal });
  L.push(`listeners=${count(ac.signal)}`);
});
row('listeners left on the signal after 40000 completed finished(r, {signal})', async (L) => {
  const ac = new AbortController();
  for (let i = 0; i < 40000; i++) {
    const r = Readable.from(['x']);
    await new Promise((res) => {
      finished(r, { signal: ac.signal }, () => res());
      r.resume();
    });
  }
  L.push(`listeners=${count(ac.signal)}`);
});
(async () => {
  for (const [name, fn] of rows) {
    const L = [];
    try {
      await Promise.race([fn(L), settle(60000).then(() => L.push('no settle in 60s'))]);
    } catch (e) {
      L.push(`threw ${e2s(e)}`);
    }
    await settle();
    console.log(`${name} => ${L.join(',')}`);
  }
  process.exit(0);
})();
