import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runToCompletion } from '../src/proc.ts';

// On-demand real native participant. No scripted/fake Codex, no paid CI lane.
const root = await mkdtemp(join(tmpdir(), 'rifty-codex-reference-'));
const config = JSON.parse(
  await readFile('tools/agent-bench/configs/gpt-6-luna.json', 'utf8'),
) as Record<string, unknown>;
config.codex = { model: 'gpt-6.1-sol', reasoning: 'low' };
config.runsPerTask = 1;
config.limits = { maxToolCalls: 100, runTimeoutMs: 180000 };
const input = join(root, 'config.json');
await writeFile(input, JSON.stringify(config));
const output = join(root, 'series');
console.log(`NATIVE_CODEX_ARTIFACTS ${root}`);
const result = await runToCompletion(
  process.execPath,
  [
    '--import',
    'tsx',
    resolve('tools/agent-bench/src/cli.ts'),
    'run',
    '--config',
    input,
    '--lane',
    'native-codex',
    '--task',
    'fix-date-sort',
    '--output',
    output,
  ],
  { cwd: process.cwd(), timeoutMs: 300000 },
);
await writeFile(join(root, 'cli.log'), `${result.stdout}\n${result.stderr}`);
assert.equal(result.code, 0, result.stderr);
const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8')) as {
  header: {
    codex: {
      model: string;
      reasoning: string;
      cliVersion: string;
      isolation: {
        ephemeral: boolean;
        ignoreUserConfig: boolean;
        ignoreRules: boolean;
        projectDocMaxBytes: number;
      };
    };
    series: { status: string };
  };
  runs: {
    lane: string;
    agentStatus: string;
    inputTokens: number;
    outputTokens: number;
    judge: { probes: unknown[] };
    finalDiff: unknown[];
    artifacts: { trace: string; workspace: string };
  }[];
};
assert.equal(report.header.series.status, 'completed');
assert.equal(report.header.codex.model, 'gpt-6.1-sol');
assert.equal(report.header.codex.reasoning, 'low');
assert.match(report.header.codex.cliVersion, /codex-cli/);
assert.deepEqual(report.header.codex.isolation, {
  ephemeral: true,
  ignoreUserConfig: true,
  ignoreRules: true,
  projectDocMaxBytes: 0,
});
assert.equal(report.runs.length, 1);
const attempt = report.runs[0]!;
assert.equal(attempt.lane, 'native-codex');
assert.equal(attempt.agentStatus, 'done');
assert.ok(attempt.inputTokens > 0);
assert.ok(attempt.outputTokens > 0);
assert.ok(attempt.judge.probes.length > 0);
assert.ok(
  attempt.finalDiff.length > 0,
  'real CLI must attempt the project, not fabricate a completion',
);
const trace = JSON.parse(await readFile(join(output, attempt.artifacts.trace), 'utf8')) as {
  events: { type: string; item?: { type: string } }[];
  exitCode: number;
};
assert.equal(trace.exitCode, 0);
assert.ok(trace.events.some((event) => event.type === 'turn.completed'));
assert.ok(
  trace.events.some((event) =>
    ['file_change', 'command_execution'].includes(event.item?.type ?? ''),
  ),
);
assert.ok(!resolve(output, attempt.artifacts.workspace).startsWith(`${process.cwd()}/`));
console.log(
  JSON.stringify({
    output,
    report: report.header,
    runs: report.runs.length,
    judgeProbes: attempt.judge.probes.length,
  }),
);

const deadlineOutput = join(root, 'deadline');
config.limits = { maxToolCalls: 100, runTimeoutMs: 1000 };
await writeFile(input, JSON.stringify(config));
const expired = await runToCompletion(
  process.execPath,
  [
    '--import',
    'tsx',
    resolve('tools/agent-bench/src/cli.ts'),
    'run',
    '--config',
    input,
    '--lane',
    'native-codex',
    '--task',
    'fix-date-sort',
    '--output',
    deadlineOutput,
  ],
  { cwd: process.cwd(), timeoutMs: 300000 },
);
await writeFile(join(root, 'deadline-cli.log'), `${expired.stdout}\n${expired.stderr}`);
assert.equal(expired.code, 0, expired.stderr);
const exhausted = JSON.parse(await readFile(join(deadlineOutput, 'report.json'), 'utf8')) as {
  runs: { agentStatus: string; outcome: string; artifacts: { trace: string } }[];
};
assert.equal(exhausted.runs.length, 1);
assert.equal(exhausted.runs[0]!.agentStatus, 'budget-exceeded');
assert.equal(exhausted.runs[0]!.outcome, 'budget-exceeded');
assert.ok(
  (await readFile(join(deadlineOutput, exhausted.runs[0]!.artifacts.trace), 'utf8')).length > 10,
);
console.log(`NATIVE_CODEX_DEADLINE ${deadlineOutput}`);
