import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { loadCorpus } from '../src/corpus.ts';
import { run } from '../src/runner.ts';
import { observedSmokeModel } from './observed-smoke-model.ts';
const root = await mkdtemp(join(tmpdir(), 'rifty-corpus-smoke-'));
const mock = await observedSmokeModel();
try {
  const config = await loadConfig('tools/agent-bench/configs/gpt-6-luna.json');
  config.runsPerTask = 1;
  config.endpoint = {
    ...config.endpoint!,
    id: 'scripted',
    name: 'scripted',
    provider: 'bench',
    baseUrl: mock.baseUrl,
    reasoning: false,
    thinking: 'off',
    compat: {},
  };
  config.codex = undefined;
  const tasks = await loadCorpus('pilot-v1');
  const report = await run(
    config,
    tasks,
    ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'],
    join(root, 'series'),
  );
  await writeFile(
    join(root, 'actual-provider-requests.json'),
    JSON.stringify(mock.requests, null, 2),
  );
  assert.equal(report.runs.length, 24);
  const observed = report.runs.filter((row) => row.agentStatus === 'done');
  assert.equal(observed.length, 10, JSON.stringify(report.runs));
  assert.equal(mock.requests.length, 20);
  for (const row of observed) {
    assert.equal(row.outcome, 'fail');
    assert.equal(row.judge.pass, false);
    const before = JSON.parse(
      await readFile(join(root, 'series', row.artifacts.before!), 'utf8'),
    ) as Record<string, string>;
    assert(!Object.keys(before).some((path) => /reference|partial|alternative|judge/.test(path)));
    assert(row.judge.probes.length > 0);
  }
  console.log(`CORPUS_SMOKE_ARTIFACTS ${root}`);
} finally {
  await mock.close();
}
