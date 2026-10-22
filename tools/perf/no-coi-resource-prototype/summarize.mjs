import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const path = process.argv[2];
const report = JSON.parse(await readFile(path, 'utf8'));
const rows = report.runs.filter((row) => !row.warmup);
assert(rows.length > 0 && rows.every((row) => row.status === 'passed'));
assert.equal(report.identicalOutputs, true);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const memory = (row, label) => {
  const record = row.memory.find((entry) => entry.label === label);
  assert.equal(record.renderers.length, 1);
  const realms = [record.page, ...record.workers];
  return {
    rss: record.rendererRssBytes,
    backing: realms.reduce((sum, value) => sum + value.backingStorageSize, 0),
    heap: realms.reduce((sum, value) => sum + value.usedSize, 0),
  };
};
const measures = {
  repeatViteReportedMs: (row) =>
    median(
      row.builds
        .filter((build) => build.temperature === 'repeat')
        .map((build) => {
          const match = build.stdout.match(/built in ([\d.]+)(ms|s)/);
          assert(match, 'Vite duration missing');
          return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
        }),
    ),
  firstBuildMs: (row) => row.builds[0].elapsedMs,
  repeatBuildMs: (row) =>
    median(
      row.builds.filter((build) => build.temperature === 'repeat').map((build) => build.elapsedMs),
    ),
  threeReadsCommandMs: (row) => median(row.reads.map((read) => read.elapsedMs)),
  oneWasmReadMs: (row) => median(row.reads.map((read) => median(read.samples))),
  echoCommandMs: (row) => median(row.echoMs),
  installedBackingBytes: (row) => memory(row, 'installed').backing,
  afterBuildBackingBytes: (row) => memory(row, 'after-build').backing,
  afterBuildHeapBytes: (row) => memory(row, 'after-build').heap,
  afterBuildRendererRssBytes: (row) => memory(row, 'after-build').rss,
  sampledBuildMaxRendererRssBytes: (row) => row.memoryBuild.sampledMaxRendererRssBytes,
  sampledReadMaxRendererRssBytes: (row) => row.memoryRead.sampledMaxRendererRssBytes,
  disposedRetainedBackingBytes: (row) => memory(row, 'disposed-retained-handle').backing,
};
const metrics = {};
for (const [name, value] of Object.entries(measures)) {
  const groups = Object.fromEntries(
    ['baseline', 'prototype'].map((variant) => {
      const samples = rows.filter((row) => row.variant === variant).map(value);
      return [
        variant,
        { median: median(samples), min: Math.min(...samples), max: Math.max(...samples), samples },
      ];
    }),
  );
  metrics[name] = {
    ...groups,
    reductionPercent: (1 - groups.prototype.median / groups.baseline.median) * 100,
    speedup: groups.baseline.median / groups.prototype.median,
  };
}
const summary = {
  contextsPerVariant: rows.filter((row) => row.variant === 'baseline').length,
  workload: {
    files: rows[0].inventory.files,
    bytes: rows[0].inventory.bytes,
    cacheBytes: rows[0].inventory.cacheBytes,
    wasm: rows[0].inventory.wasm,
    versions: rows[0].inventory.versions,
  },
  identicalOutputs: report.identicalOutputs,
  metrics,
};
const output = path.replace(/\.json$/, '-summary.json');
await writeFile(output, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
