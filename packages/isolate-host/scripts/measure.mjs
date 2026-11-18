#!/usr/bin/env node
/**
 * Per-call cost of `runCode` on this machine (README §Cost). Usage, from the
 * package directory after `pnpm run build`:
 *
 *   node scripts/measure.mjs
 *
 * Reports p50/max of a trivial call, one child's peak RSS, and the peak total
 * RSS of 1/4/8 concurrent calls. Sequential runs only; no warm pool exists.
 */
import { execFileSync } from 'node:child_process';
import { runCode } from '../dist/index.js';

const children = () =>
  execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([, parent]) => parent === process.pid);

const peakRss = async (work) => {
  let peak = 0;
  const sampler = setInterval(() => {
    const total = children().reduce((sum, [, , rss]) => sum + rss, 0) / 1024;
    peak = Math.max(peak, total);
  }, 20);
  try {
    await work();
  } finally {
    clearInterval(sampler);
  }
  return Math.round(peak);
};

const times = [];
for (let i = 0; i < 11; i++) {
  const started = performance.now();
  await runCode('console.log(1)');
  times.push(performance.now() - started);
}
times.shift();
times.sort((a, b) => a - b);
console.log(
  `runCode('console.log(1)'): p50 ${Math.round(times[4])} ms, max ${Math.round(times.at(-1))} ms (10 sequential)`,
);
console.log(
  `one child at rest: ${await peakRss(() => runCode('setTimeout(() => {}, 1500)'))} MiB peak RSS`,
);
for (const n of [1, 4, 8]) {
  const started = performance.now();
  const peak = await peakRss(() =>
    Promise.all(Array.from({ length: n }, () => runCode('setTimeout(() => {}, 500)'))),
  );
  console.log(
    `${n} concurrent: ${peak} MiB peak child RSS, ${Math.round(performance.now() - started)} ms wall`,
  );
}
console.log(`node ${process.version}, ${process.platform}/${process.arch}`);
