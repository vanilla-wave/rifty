// Not the worker's: no IPC/protocol, `write` a no-op, no `rejection` lookup or `__riftyGuest` delete,
// no isolate callbacks (catastrophic error, dynamic import, unhandled rejection), a synchronous
// dispose, HEAD's host bridge for every bundle; `total` = the sum of the phases' medians.
// Phases of one warm `runCode('1')`-shaped call, worker side, as packages/isolate-host/src/child/main.ts
// runs them: a fresh isolate, its context and bridge, the guest bundle compiled from the code cache,
// the bundle's top-level evaluation, then `run('1')` (setUp: runtime installs, the Node-sources
// globals, the eval entry and its drain). Per guest bundle given; alternating ABAB…, medians.
// usage (repo root, after `pnpm --filter @riftydev/isolate-host build`):
//   [LIMIT=128] node --no-node-snapshot docs/backlog/distribution/reference/isolate-guest-load-cost/probe.mjs N guest.js [guest.js …]
// An older bundle: `git checkout <rev> -- packages/{isolate-guest,runtime-js,io,vfs,kernel,net}`,
// `node scripts/build-guest.mjs` in packages/isolate-guest, copy dist/guest.js, check out HEAD again.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../../../../packages/isolate-host/package.json', import.meta.url),
);
const ivm = require('isolated-vm');
const { createHostBridge } = await import(
  new URL('../../../../../packages/isolate-guest/dist/index.js', import.meta.url).href
);
const [nArg, ...bundles] = process.argv.slice(2);
const N = Number(nArg);
const sources = bundles.map((p) => readFileSync(p, 'utf8'));
const caches = sources.map(() => undefined);

async function once(i) {
  const t = [performance.now()];
  const isolate = new ivm.Isolate({ memoryLimit: Number(process.env.LIMIT ?? 256) });
  const context = await isolate.createContext();
  const fireRef = {};
  const bridge = createHostBridge({
    write() {},
    fire: (timer) => fireRef.ref?.apply(undefined, [timer]),
  });
  for (const [name, fn] of Object.entries(bridge.functions))
    await context.global.set(`__riftyHost_${name}`, new ivm.Callback(fn));
  await context.eval(`{ const bridge = { timeOrigin: ${bridge.timeOrigin}, allowSharedArrayBuffer: true };
    for (const name of ${JSON.stringify(Object.keys(bridge.functions))}) { bridge[name] = globalThis['__riftyHost_' + name]; delete globalThis['__riftyHost_' + name]; }
    Object.defineProperty(globalThis, '__riftyIsolateHost', { value: Object.freeze(bridge), configurable: true }); }`);
  t.push(performance.now());
  const script = await isolate.compileScript(sources[i], {
    filename: 'rifty-isolate-guest.js',
    ...(caches[i] === undefined ? { produceCachedData: true } : { cachedData: caches[i] }),
  });
  if (caches[i] === undefined) caches[i] = script.cachedData;
  else if (script.cachedDataRejected === true) throw new Error('code cache rejected');
  t.push(performance.now());
  await script.run(context);
  t.push(performance.now());
  const guest = await context.global.get('__riftyGuest', { reference: true });
  fireRef.ref = await guest.get('fire', { reference: true });
  const run = await guest.get('run', { reference: true });
  const code = await run.apply(undefined, ['1'], {
    arguments: { copy: true },
    result: { promise: true, copy: true },
  });
  t.push(performance.now());
  bridge.close();
  isolate.dispose();
  t.push(performance.now());
  if (code !== 0) throw new Error(`run ended ${code}`);
  return t.slice(1).map((v, k) => v - t[k]);
}
const PHASES = [
  'isolate+context+bridge',
  'compile (code cache)',
  'bundle top-level',
  "run('1')",
  'dispose',
];
const samples = sources.map(() => PHASES.map(() => []));
for (let w = 0; w < 10; w++) for (let i = 0; i < sources.length; i++) await once(i);
for (let k = 0; k < N; k++)
  for (let j = 0; j < sources.length; j++) {
    const i = k % 2 === 0 ? j : sources.length - 1 - j;
    const r = await once(i);
    r.forEach((v, p) => samples[i][p].push(v));
  }
const med = (x) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
for (let i = 0; i < sources.length; i++) {
  const m = samples[i].map(med);
  console.log(
    `${bundles[i]} (${sources[i].length} B): ${PHASES.map((p, k) => `${p} ${m[k].toFixed(2)}`).join(' | ')} | total ${m.reduce((a, b) => a + b, 0).toFixed(2)} ms`,
  );
}
