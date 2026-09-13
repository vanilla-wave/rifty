import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { AgentPromptProfile } from '@riftydev/agent';
import { agentModelServer } from '../../../tests/e2e/fixtures/agent-model-server.ts';
import { observedSmokeModel } from './observed-smoke-model.ts';

function getAgentPromptProfile(): AgentPromptProfile {
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      "import('./packages/agent/src/index.ts').then(module => console.log(JSON.stringify(module.getAgentPromptProfile())))",
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  return JSON.parse(output) as AgentPromptProfile;
}

const tasks = ['fix-date-sort', 'add-search', 'url-filters', 'new-issue-form', 'node-endpoint'];
interface RunRecord {
  task: string;
  lane: 'rifty' | 'rifty-no-coi' | 'local-reference';
  runIndex: number;
  agentStatus: string;
  outcome: string;
  toolCalls: number;
  terminalTail: string;
  judge: { pass: boolean; probes: unknown[] };
  artifacts: { trace: string; browserTrace?: string; workspace?: string };
  profile: string;
  finalDiff: unknown;
  failureClass: string | null;
  note: string | null;
}
interface Report {
  header: { model: string; profile: string; runsPerTask: number; toolContextCaveat: string };
  runs: RunRecord[];
}

async function cli(args: string[], extraEnv: Record<string, string> = {}) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', resolve('tools/agent-bench/src/cli.ts'), ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const code = await new Promise<number | null>((done, reject) => {
    child.once('error', reject);
    child.once('close', done);
  });
  return { code, output };
}

// RED scaffold is callable and loud; it cannot substitute a fabricated successful report.
test('the public shared coding profile is available to browser and native CLI consumers', () => {
  const profile = getAgentPromptProfile();
  expect(profile.id).toBe('pi-0.85.1+rifty-adapter-v1');
  for (const part of [profile.intro, profile.guidance, profile.recovery, profile.verification])
    expect(part.length).toBeGreaterThan(20);
});

test('all three real mock-model lanes run the entire task set with identical judge evidence', async () => {
  const out = await mkdtemp(join(tmpdir(), 'rifty-agent-bench-smoke-'));
  // The provider lives outside the runner: report-only fabrication makes zero requests.
  const model = await observedSmokeModel();
  const config = join(out, 'config.json');
  await writeFile(
    config,
    JSON.stringify({ endpoint: { baseUrl: model.baseUrl, model: 'scripted' } }),
  );
  let result: Awaited<ReturnType<typeof cli>>;
  try {
    result = await cli(['run', '--runs', '1', '--config', config, '--output', out]);
  } finally {
    await model.close();
  }
  expect(result.code, result.output).toBe(0);
  expect(model.requests).toHaveLength(28);
  const completedReads = model.requests.filter((request) =>
    request.body.messages.some((message) => message.role === 'tool'),
  );
  expect(completedReads).toHaveLength(14);
  const profile = getAgentPromptProfile();
  for (const request of completedReads) {
    expect(request.authorization).toBeNull();
    const system = request.body.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n');
    for (const part of [profile.intro, profile.guidance, profile.recovery, profile.verification])
      expect(system).toContain(part);
    const result = JSON.stringify(
      request.body.messages.filter((message) => message.role === 'tool'),
    );
    expect(result).toContain('dependencies');
    expect(result).toMatch(/react|hono/);
  }
  const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8')) as Report;
  expect(report.header.runsPerTask).toBe(1);
  expect(report.header.toolContextCaveat).toMatch(/not.*equivalent|non-equivalence/i);
  expect(report.runs).toHaveLength(14);
  expect(report.header.profile).toBe(profile.id);
  for (const task of tasks) {
    const runs = report.runs.filter((run) => run.task === task);
    expect(runs.map((run) => run.lane).sort()).toEqual(
      (task === 'node-endpoint'
        ? ['rifty', 'local-reference']
        : ['rifty', 'rifty-no-coi', 'local-reference']
      ).sort(),
    );
    expect(new Set(runs.map((run) => JSON.stringify(run.judge))).size).toBe(1);
    for (const run of runs) {
      expect(run.runIndex).toBe(1);
      expect(run.agentStatus).toBe('done');
      // The smoke model reads the real package.json, then stops; planted task defects remain.
      expect(run.outcome).toBe('fail');
      expect(run.judge.pass).toBe(false);
      expect(run.judge.probes.length).toBeGreaterThan(0);
      expect(run.toolCalls).toBe(1);
      expect(run.terminalTail).toBe('');
      expect(run.profile).toBe(profile.id);
      expect((await stat(join(out, run.artifacts.trace))).size).toBeGreaterThan(100);
      {
        if (!run.artifacts.browserTrace) throw new Error(`No actual browser trace for ${run.lane}`);
        const zip = join(out, run.artifacts.browserTrace);
        const trace = execFileSync('unzip', ['-p', zip, '*.trace'], {
          encoding: 'utf8',
          maxBuffer: 30 * 1024 * 1024,
        });
        const events = trace
          .split('\n')
          .filter(Boolean)
          .map(
            (line) =>
              JSON.parse(line) as {
                type: string;
                title?: string;
                callId?: string;
                parentId?: string;
                method?: string;
                class?: string;
              },
          );
        // A dedicated real tracing group encloses the common judge, independently of agent actions.
        const group = events.findIndex(
          (event) =>
            event.type === 'before' &&
            event.method === 'tracingGroup' &&
            event.title === `judge:${task}`,
        );
        expect(group, trace.slice(-2000)).toBeGreaterThanOrEqual(0);
        const end = events.findIndex(
          (event, index) =>
            index > group && event.type === 'after' && event.callId === events[group]?.callId,
        );
        expect(end).toBeGreaterThan(group);
        const judgeActions = JSON.stringify(events.slice(group + 1, end));
        const oracleAction: Record<string, string> = {
          'fix-date-sort': '.recent-list a',
          'add-search': 'input',
          'url-filters': 'selectOption',
          'new-issue-form': 'new issue',
          'node-endpoint': 'api/stats',
        };
        expect(judgeActions.toLowerCase()).toContain(oracleAction[task]!.toLowerCase());
        expect(
          events
            .slice(group + 1, end)
            .some(
              (event) =>
                event.type === 'before' &&
                event.parentId === events[group]?.callId &&
                (event.class === 'Frame' || event.class === 'APIRequestContext'),
            ),
        ).toBe(true);
      }
    }
  }
  report.runs[0]!.failureClass = 'task-bad';
  report.runs[0]!.note = 'Intentional unchanged mock baseline.';
  await writeFile(join(out, 'report.json'), JSON.stringify(report));
  const regenerated = await cli(['report', out]);
  expect(regenerated.code, regenerated.output).toBe(0);
  const summary = await readFile(join(out, 'summary.md'), 'utf8');
  expect(summary).toContain('budget-exceeded');
  expect(summary).toContain('Intentional unchanged mock baseline.');
  expect(
    (JSON.parse(await readFile(join(out, 'report.json'), 'utf8')) as Report).runs[0]?.failureClass,
  ).toBe('task-bad');
});

for (const lane of ['rifty', 'rifty-no-coi', 'local-reference'] as const) {
  test(`${lane} reports budget exhaustion and preserves only the admitted write`, async () => {
    const name = lane === 'local-reference' ? 'write' : 'write_file';
    const model = await agentModelServer([
      [{ name, args: { path: 'admitted-budget.txt', content: 'retained native write' } }],
      [{ name, args: { path: 'blocked-budget.txt', content: 'must not be executed' } }],
      'An exhausted budget must not ask for this response.',
    ]);
    const out = await mkdtemp(join(tmpdir(), `rifty-agent-bench-${lane}-budget-`));
    const config = join(out, 'config.json');
    await writeFile(
      config,
      JSON.stringify({
        endpoint: { baseUrl: model.baseUrl, model: 'scripted' },
        limits: { maxToolCalls: 1, runTimeoutMs: 60000 },
      }),
    );
    try {
      const result = await cli([
        'run',
        '--lane',
        lane,
        '--task',
        'add-search',
        '--runs',
        '1',
        '--config',
        config,
        '--output',
        out,
      ]);
      expect(result.code, result.output).toBe(0);
      const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8')) as Report;
      expect(report.runs).toHaveLength(1);
      const run = report.runs[0]!;
      expect(run.outcome).toBe('budget-exceeded');
      expect(run.toolCalls).toBe(1);
      expect(JSON.stringify(run.finalDiff)).toContain('admitted-budget.txt');
      expect(JSON.stringify(run.finalDiff)).not.toContain('blocked-budget.txt');
      expect(model.requests).toHaveLength(2);
      expect(model.requests.every((request) => request.authorization === null)).toBe(true);
    } finally {
      await model.close();
    }
  });
}

test('provider failure after a real UI write retains its evidence in the run report', async () => {
  const model = await agentModelServer([
    [
      {
        name: 'write_file',
        args: { path: 'provider-retained.txt', content: 'persisted before provider failure' },
      },
    ],
    { error: 'BENCH_PROVIDER_FAILURE_AFTER_WRITE' },
  ]);
  const out = await mkdtemp(join(tmpdir(), 'rifty-agent-bench-provider-'));
  const config = join(out, 'config.json');
  await writeFile(
    config,
    JSON.stringify({ endpoint: { baseUrl: model.baseUrl, model: 'scripted' } }),
  );
  try {
    const result = await cli([
      'run',
      '--lane',
      'rifty',
      '--task',
      'add-search',
      '--runs',
      '1',
      '--config',
      config,
      '--output',
      out,
    ]);
    expect(result.code, result.output).toBe(0);
    const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8')) as Report;
    expect(report.runs[0]?.agentStatus).toBe('error');
    expect(report.runs[0]?.outcome).toBe('fail');
    expect(JSON.stringify(report.runs[0]?.finalDiff)).toContain(
      'persisted before provider failure',
    );
    const trace = await readFile(join(out, report.runs[0]!.artifacts.trace), 'utf8');
    expect(trace).toContain('BENCH_PROVIDER_FAILURE_AFTER_WRITE');
    expect(model.requests).toHaveLength(2);
  } finally {
    await model.close();
  }
});

test('configured key reaches only the provider and is absent from every persisted trace', async () => {
  const key = 'PR333_SYNTHETIC_BENCH_KEY';
  const model = await agentModelServer([{ error: `Rejected synthetic key ${key}` }]);
  const out = await mkdtemp(join(tmpdir(), 'rifty-agent-bench-key-'));
  const config = join(out, 'config.json');
  await writeFile(
    config,
    JSON.stringify({
      endpoint: { baseUrl: model.baseUrl, model: 'scripted', envKey: 'RIFTY_BENCH_TEST_KEY' },
    }),
  );
  try {
    const result = await cli(
      [
        'run',
        '--lane',
        'rifty',
        '--task',
        'add-search',
        '--runs',
        '1',
        '--config',
        config,
        '--output',
        out,
      ],
      { RIFTY_BENCH_TEST_KEY: key },
    );
    expect(result.code, result.output).toBe(0);
    expect(model.requests[0]?.authorization).toBe(`Bearer ${key}`);
    const json = await readFile(join(out, 'report.json'), 'utf8');
    expect(json).not.toContain(key);
    const report = JSON.parse(json) as Report;
    const run = report.runs[0]!;
    expect(await readFile(join(out, run.artifacts.trace), 'utf8')).not.toContain(key);
    // Playwright console/action snapshots can contain provider errors verbatim.
    // Keyed runs retain redacted textual evidence; raw browser tracing is omitted explicitly.
    expect(run.artifacts.browserTrace).toBeUndefined();
    expect(await readFile(join(out, 'summary.md'), 'utf8')).not.toContain(key);
  } finally {
    await model.close();
  }
});

test('invalid configured limits fail explicitly before producing run records', async () => {
  const out = await mkdtemp(join(tmpdir(), 'rifty-agent-bench-config-'));
  const config = join(out, 'config.json');
  await writeFile(config, JSON.stringify({ limits: { maxToolCalls: 0 } }));
  const result = await cli(['run', '--mock-model', '--config', config, '--output', out]);
  expect(result.code).not.toBe(0);
  expect(result.output).toMatch(/maxToolCalls.*positive|positive.*maxToolCalls/i);
  await expect(stat(join(out, 'report.json'))).rejects.toThrow();
});

for (const lane of ['rifty', 'rifty-no-coi', 'local-reference'] as const) {
  test(`${lane} reports the configured deadline while the model stream remains open`, async () => {
    const model = await agentModelServer(['Waiting for finish.']);
    model.holdFinal('Waiting for finish.');
    const out = await mkdtemp(join(tmpdir(), `rifty-agent-bench-${lane}-time-`));
    const config = join(out, 'config.json');
    await writeFile(
      config,
      JSON.stringify({
        endpoint: { baseUrl: model.baseUrl, model: 'scripted' },
        limits: { maxToolCalls: 100, runTimeoutMs: 1000 },
      }),
    );
    try {
      const result = await cli([
        'run',
        '--lane',
        lane,
        '--task',
        'add-search',
        '--runs',
        '1',
        '--config',
        config,
        '--output',
        out,
      ]);
      expect(result.code, result.output).toBe(0);
      const report = JSON.parse(await readFile(join(out, 'report.json'), 'utf8')) as Report;
      expect(report.runs[0]?.outcome).toBe('budget-exceeded');
      expect(report.runs[0]?.toolCalls).toBe(0);
      expect(model.requests).toHaveLength(1);
    } finally {
      await model.close();
    }
  });
}
