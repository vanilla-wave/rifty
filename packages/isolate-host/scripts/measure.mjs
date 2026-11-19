#!/usr/bin/env node
/**
 * Cost of `runCode` on this machine (README §Cost). Usage, from the package
 * directory after `pnpm run build`:
 *
 *   node scripts/measure.mjs
 *
 * Reports the first call (worker spawn + uncached compile), p50/max of a
 * trivial call on a warm worker, worker RSS with 1..4 concurrent calls, and
 * the peak total worker RSS of 8 concurrent calls (2 workers). Each section
 * runs in a fresh consumer process so pools do not carry over.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === undefined) {
  for (const section of ['latency', 'shard', 'eight']) {
    process.stdout.write(
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), section], { encoding: 'utf8' }),
    );
  }
  console.log(`node ${process.version}, ${process.platform}/${process.arch}`);
  process.exit(0);
}

const { runCode } = await import('../dist/index.js');
const children = () =>
  execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([, parent]) => parent === process.pid);
const peakRss = async (work) => {
  let peak = 0;
  const sample = () => {
    const total = children().reduce((sum, [, , rss]) => sum + rss, 0) / 1024;
    peak = Math.max(peak, total);
  };
  const sampler = setInterval(sample, 20);
  try {
    await work();
    sample();
  } finally {
    clearInterval(sampler);
  }
  return Math.round(peak);
};
const section = process.argv[2];
if (section === 'latency') {
  let started = performance.now();
  await runCode('console.log(1)');
  console.log(`first call (worker spawn, uncached compile): ${Math.round(performance.now() - started)} ms`);
  await runCode('console.log(1)');
  const times = [];
  for (let i = 0; i < 20; i++) {
    started = performance.now();
    await runCode('console.log(1)');
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  console.log(
    `warm worker runCode('console.log(1)'): p50 ${times[9].toFixed(1)} ms, max ${times.at(-1).toFixed(1)} ms (20 sequential)`,
  );
} else if (section === 'shard') {
  await runCode('console.log(1)');
  for (const n of [1, 2, 3, 4]) {
    const peak = await peakRss(() =>
      Promise.all(Array.from({ length: n }, () => runCode('setTimeout(() => {}, 500)'))),
    );
    console.log(`${n} concurrent on one worker: ${peak} MiB peak worker RSS`);
  }
} else {
  const started = performance.now();
  const peak = await peakRss(() =>
    Promise.all(Array.from({ length: 8 }, () => runCode('setTimeout(() => {}, 500)'))),
  );
  console.log(
    `8 concurrent, cold (2 workers): ${peak} MiB peak total RSS, ${Math.round(performance.now() - started)} ms wall`,
  );
}
