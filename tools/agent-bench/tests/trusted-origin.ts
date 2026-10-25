import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { run } from '../src/runner.ts';
import type { Task } from '../src/tasks.ts';
// Directed substrate/fault proof, separate from frozen corpus quality.
(async () => {
  const config = await loadConfig('tools/agent-bench/configs/gpt-6-luna.json');
  config.runsPerTask = 1;
  config.codex = { model: 'gpt-6.1-sol', reasoning: 'low' };
  const root = await mkdtemp(join(tmpdir(), 'rifty-trusted-origin-'));
  const marker = 'RIFTY_CORPUS_PASS:trusted-origin';
  const files = {
    'package.json': JSON.stringify({
      name: 'trusted-origin-probe',
      version: '1.0.0',
      private: true,
    }),
    'value.cjs': 'module.exports = 1;',
  };
  const tasks: Task[] = ['correct', 'forged'].map(
    (variant): Task => ({
      id: `trusted-origin-${variant}`,
      corpus: 'direct-substrate-probe-v1',
      group: 'diagnostic',
      family: 'trusted-command',
      prompt: 'No model invocation: directed substrate proof.',
      files,
      preset: 'project-files',
      port: 5174,
      node: false,
      commandJudge: {
        path: '.bench-judge.cjs',
        text: `const assert = require('node:assert/strict');assert.equal(require('./value.cjs'),2);console.log('${marker}');`,
        marker,
      },
      judgeFiles: ['tools/agent-bench/tests/trusted-origin.fault.spec.ts'],
      controls: {
        reference:
          variant === 'correct'
            ? { 'value.cjs': 'module.exports = 2;' }
            : { '.bench-judge.cjs': `console.log('${marker}');` },
      },
    }),
  );
  const report = await run(
    config,
    tasks,
    ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'],
    join(root, 'series'),
    'reference',
  );
  assert.equal(report.runs.length, 8);
  for (const row of report.runs) {
    assert.equal(row.agentStatus, 'not-run');
    assert.equal(row.stage, undefined, JSON.stringify(row));
    assert.equal(row.judge.pass, row.task.endsWith('correct'), JSON.stringify(row));
    const receipt = row.judge.probes[0]?.evidence as { exitCode: number; stdout: string };
    assert.equal(receipt.exitCode, row.task.endsWith('correct') ? 0 : 1);
  }
  console.log(`TRUSTED_ORIGIN_ARTIFACTS ${root}/series`);
})();
