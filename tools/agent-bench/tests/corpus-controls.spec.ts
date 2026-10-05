import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
// Deterministic real origin controls; no agent/model emulation or paid CI participant.
test('every selected pilot reference is judged in its real origin, with retained failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rifty-pilot-controls-'));
  const output = join(root, 'series');
  const config = JSON.parse(
    await readFile('tools/agent-bench/configs/gpt-6-luna.json', 'utf8'),
  ) as Record<string, unknown>;
  config.codex = { model: 'gpt-6.1-sol', reasoning: 'low' };
  const input = join(root, 'config.json');
  await writeFile(input, JSON.stringify(config));
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      resolve('tools/agent-bench/src/cli.ts'),
      'controls',
      '--suite',
      'pilot-v1',
      '--config',
      input,
      '--control',
      'reference',
      '--lane',
      'all',
      '--runs',
      '1',
      '--output',
      output,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout.on('data', (d: Buffer) => {
    log += d;
  });
  child.stderr.on('data', (d: Buffer) => {
    log += d;
  });
  const code = await new Promise<number | null>((done, reject) => {
    child.once('error', reject);
    child.once('close', done);
  });
  expect(code, log).toBe(0);
  const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) as {
    header: { purpose: string; series: { status: string; trials: unknown[] } };
    runs: {
      task: string;
      lane: string;
      agentStatus: string;
      outcome: string;
      stage?: string;
      error?: string;
      judge: { pass: boolean; probes: { evidence: unknown }[] };
      artifacts: { before?: string; after?: string };
    }[];
  };
  expect(report.header.purpose).toBe('controls');
  expect(report.header.series.trials).toHaveLength(24);
  expect(report.runs).toHaveLength(24);
  for (const task of [
    'ms-negative',
    'ms-weeks',
    'stringify-boxed',
    'queue-clear',
    'csv-workflow',
    'markdown-notes',
  ]) {
    const rows = report.runs.filter((row) => row.task === task);
    expect(rows.map((row) => row.lane).sort()).toEqual(
      ['rifty', 'rifty-no-coi', 'local-reference', 'native-codex'].sort(),
    );
    for (const row of rows) {
      expect(row.agentStatus).toBe('not-run');
      expect(row.judge.pass || !!row.error || row.judge.probes.length > 0).toBe(true);
      if (row.outcome === 'pass') expect(row.judge.pass).toBe(true);
    }
  }
  for (const row of report.runs.filter(
    (row) => row.lane === 'local-reference' || row.lane === 'native-codex',
  ))
    expect(row.judge.pass, JSON.stringify(row)).toBe(true);
  console.log(`PILOT_CONTROL_ARTIFACTS ${output}`);
});
