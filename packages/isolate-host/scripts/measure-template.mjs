#!/usr/bin/env node
/**
 * Cost of a sandbox over a template (README §Template), through the public API only. From the
 * package directory after `pnpm run build`:
 *
 *   node --expose-gc scripts/measure-template.mjs <artifact> [generators dir]
 *
 * `<artifact>`: a `produceDependencySnapshot` artifact; the generators dir holds `<kind>.cjs`
 * files run as `node <file> out.<kind>` (default: `tests/fixtures/template`, the four
 * libraries' generators). Medians; the smallest `memoryLimitMb` by 4 MiB bisection.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv.splice(i, 2)[1];
};
// `--repeat N --limits a,b,…`: instead of the table, N runs of each file at each `memoryLimitMb`,
// counting the runs that did not keep their files (the reliable limit, not one bisection).
const repeat = Number(flag('--repeat') ?? 0);
// `--concurrent N`: N sandboxes run pdf.cjs at once, 10 rounds: latency and the workers' RSS.
const concurrent = Number(flag('--concurrent') ?? 0);
// `default` (0): no `memoryLimitMb`, the sandbox's own default.
const limits = (flag('--limits') ?? '')
  .split(',')
  .filter(Boolean)
  .map((l) => (l === 'default' ? 0 : Number(l)));
const [artifactPath, gens = fileURLToPath(new URL('../tests/fixtures/template', import.meta.url))] =
  argv;
if (artifactPath === undefined)
  throw new Error('usage: measure-template.mjs <artifact> [generators dir]');
if (typeof gc !== 'function') throw new Error('run with node --expose-gc');
const { createSandbox, registerTemplate } = await import('../dist/index.js');
const MiB = 2 ** 20;
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const time = async (fn) => {
  const t = performance.now();
  await fn();
  return performance.now() - t;
};
const ms = (x) => `${x.toFixed(x < 10 ? 2 : 0)} ms`;
const rows = [];
const row = (what, value) => {
  rows.push([what, value]);
  console.log(`${what}: ${value}`);
};

const artifact = readFileSync(artifactPath);
row('artifact', `${(artifact.byteLength / MiB).toFixed(1)} MiB`);
let template;
row(
  '`registerTemplate` (decode, first)',
  ms(
    await time(async () => {
      template = await registerTemplate(artifact);
    }),
  ),
);
row('`registerTemplate` again (same bytes)', ms(await time(() => registerTemplate(artifact))));
// Every option at its default: `maxFsBytes` 64 MiB of the agent's own files, the template on top.
const open = () => createSandbox({ template });
const creates = [];
for (let i = 0; i < 5; i++) {
  let sb;
  creates.push(
    await time(async () => {
      sb = await open();
    }),
  );
  await sb.destroy();
}
row('`createSandbox({ template })`', ms(median(creates)));

// Idle memory per sandbox: heap + ArrayBuffers over a settled idle level, 4 sandboxes.
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
await settle();
const mem = () => {
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
};
const base = mem();
const idle = [];
for (let i = 0; i < 4; i++) idle.push(await open());
await settle();
row('idle sandbox, your process', `${((mem() - base) / 4 / MiB).toFixed(1)} MiB`);
await Promise.all(idle.map((s) => s.destroy()));

if (concurrent > 0) {
  const { execFileSync } = await import('node:child_process');
  const workersRss = () =>
    execFileSync('ps', ['-A', '-o', 'ppid=,rss='], { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim().split(/\s+/).map(Number))
      .filter(([parent]) => parent === process.pid)
      .reduce((n, [, rss]) => n + rss, 0) / 1024;
  const boxes = await Promise.all(Array.from({ length: concurrent }, () => open()));
  const pdf = readFileSync(join(gens, 'pdf.cjs'));
  for (const b of boxes) await b.writeFile('/workspace/pdf.cjs', pdf);
  let peakRss = 0;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, workersRss());
  }, 50);
  const lat = [];
  let lost = 0;
  for (let round = 0; round < 10; round++)
    await Promise.all(
      boxes.map(async (b) => {
        const t = performance.now();
        const r = await b.exec('pdf.cjs', { args: ['out.pdf'] });
        lat.push(performance.now() - t);
        if (r.exitCode !== 0 || r.stateRefused !== undefined || r.termination !== undefined) lost++;
      }),
    );
  clearInterval(sampler);
  console.log(
    `${concurrent} at once, 10 rounds: exec median ${ms(median(lat))}, max ${ms(Math.max(...lat))}, lost ${lost}/${lat.length}, workers' RSS peak ${peakRss.toFixed(0)} MiB`,
  );
  await Promise.all(boxes.map((b) => b.destroy()));
  process.exit(0);
}

const sb = await open();
if (repeat > 0) {
  await sb.writeFile('/workspace/empty.cjs', '');
  const files = readdirSync(gens).filter((n) => n.endsWith('.cjs') && n !== 'resolve.cjs');
  for (const name of files)
    await sb.writeFile(`/workspace/${name}`, readFileSync(join(gens, name)));
  console.log(`default limits, ${repeat} runs each`);
  for (const limit of limits) {
    for (const name of ['empty.cjs', ...files.sort()]) {
      const failed = [];
      for (let i = 0; i < repeat; i++) {
        const r = await sb.exec(name, {
          args: [`out.${name.slice(0, -4)}`],
          ...(limit === 0 ? {} : { memoryLimitMb: limit }),
        });
        if (r.exitCode !== 0 || r.stateRefused !== undefined || r.termination !== undefined)
          failed.push(r.stateRefused ?? r.termination ?? `exit ${r.exitCode}`);
      }
      console.log(
        `memoryLimitMb ${limit} ${name}: ${failed.length}/${repeat} failed ${failed.join(' ')}`,
      );
    }
  }
  await sb.destroy();
  process.exit(0);
}
const writes = [];
for (let i = 0; i < 7; i++)
  writes.push(await time(() => sb.writeFile(`/workspace/w${i}.bin`, new Uint8Array(10 * 1024))));
row('host `writeFile` 10 KiB', ms(median(writes)));
const reads = [];
for (let i = 0; i < 7; i++) reads.push(await time(() => sb.list('/node_modules')));
row('host `list(/node_modules)`', ms(median(reads)));

const execs = async (file, args, n, memoryLimitMb) => {
  const out = [];
  let last;
  for (let i = 0; i < n; i++)
    out.push(
      await time(async () => {
        last = await sb.exec(file, { args, memoryLimitMb });
      }),
    );
  return { ms: median(out), last };
};
const ok = (r) => r.exitCode === 0 && r.stateRefused === undefined && r.termination === undefined;
/** The smallest `memoryLimitMb` (4 MiB steps) the run passes with. */
const least = async (file, args) => {
  let lo = 64; // fails
  let hi = 512; // passes
  while (hi - lo > 4) {
    const mid = lo + Math.round((hi - lo) / 8) * 4;
    const { last } = await execs(file, args, 1, mid);
    if (ok(last)) hi = mid;
    else lo = mid;
  }
  return hi;
};

await sb.writeFile('/workspace/empty.js', '');
await execs('empty.js', [], 1);
const empty = await execs('empty.js', [], 5);
row('warm `exec` of an empty file', ms(empty.ms));
row('least `memoryLimitMb`, empty file', `${await least('empty.js', [])}`);
for (const name of readdirSync(gens)
  .filter((n) => n.endsWith('.cjs') && n !== 'resolve.cjs')
  .sort()) {
  const kind = name.slice(0, -4);
  await sb.writeFile(`/workspace/${name}`, readFileSync(join(gens, name)));
  const r = await execs(name, [`out.${kind}`], 3);
  if (!ok(r.last)) throw new Error(`${name}: ${JSON.stringify(r.last)}`);
  row(`warm \`exec\` of ${name}`, ms(r.ms));
  row(`least \`memoryLimitMb\`, ${name}`, `${await least(name, [`out.${kind}`])}`);
}
// Your process during one `exec` of pdf.cjs: its peak (heap + ArrayBuffers over the idle level)
// and the longest gap of a 1 ms timer (the event loop blocked by encoding / decoding the state).
gc();
const idleLevel = mem();
let peak = 0;
let stall = 0;
let last = performance.now();
const tick = setInterval(() => {
  const now = performance.now();
  stall = Math.max(stall, now - last);
  last = now;
  peak = Math.max(peak, mem() - idleLevel);
}, 1);
await sb.exec('pdf.cjs', { args: ['out.pdf'] });
clearInterval(tick);
row('your process during one `exec` (pdf): peak over idle', `${(peak / MiB).toFixed(0)} MiB`);
row('your event loop during one `exec` (pdf): longest stall', ms(stall));
await sb.destroy();
console.log(`\nnode ${process.version}, ${process.platform}/${process.arch}`);
console.log(`| | value |\n|---|---|\n${rows.map(([a, b]) => `| ${a} | ${b} |`).join('\n')}`);
process.exit(0);
