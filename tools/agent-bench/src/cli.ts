/**
 * agent-bench CLI (tsx entry; root script `agent-bench`).
 *
 *   pnpm agent-bench -- run --lane rifty|local-reference|both [--task <slug>]
 *        [--runs N] [--config <path>] [--mock-model] [--dry-judge]
 *   pnpm agent-bench -- report <dir>
 *
 * On-demand diagnostic only — never a CI gate (ADR-0191).
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type BenchConfig, loadConfig } from './config.ts';
import { createLocalReferenceLane } from './lanes/local-reference.ts';
import { createRiftyLane } from './lanes/rifty.ts';
import type { LaneAdapter } from './lanes/types.ts';
import { MOCK_ENV_KEY, MOCK_MODEL_ID, startMockModelServer } from './mock-model.ts';
import { regenerateSummary } from './report.ts';
import { runBench } from './runner.ts';
import { ALL_TASK_SLUGS, loadTasks } from './tasks.ts';

const BENCH_ROOT = fileURLToPath(new URL('..', import.meta.url));

const USAGE = `agent-bench — external two-lane validation harness (ADR-0191)

Usage:
  agent-bench run --lane <rifty|local-reference|both> [options]
  agent-bench report <dir>     regenerate summary.md after human classification
  agent-bench --help

Options (run):
  --lane <lane>     rifty | local-reference | both (default: both)
  --task <slug>     run a single task (default: all of task-set-v1:
                    ${ALL_TASK_SLUGS.join(', ')})
  --runs <n>        runs per task (default: config runsPerTask, 3)
  --config <path>   JSON config: endpoint {baseUrl, model, envKey}, limits
                    {maxToolCalls, runTimeoutMs, toolTimeoutMs}, runsPerTask,
                    playgroundPort (RIFTY_PLAYGROUND_PORT respected)
  --mock-model      run against a local scripted OpenAI-compatible SSE server
                    (no tokens spent; plumbing smoke)
  --dry-judge       skip page-based judging; record what WOULD be judged

The endpoint API key is read from the env var named by endpoint.envKey
(default OPENAI_API_KEY) by the pi CLI itself — never stored anywhere.
Reports land in tools/agent-bench/reports/<run-id>/ (gitignored).`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function makeRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

async function runCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      lane: { type: 'string', default: 'both' },
      task: { type: 'string' },
      runs: { type: 'string' },
      config: { type: 'string' },
      'mock-model': { type: 'boolean', default: false },
      'dry-judge': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const laneArg = values.lane as string;
  if (!['rifty', 'local-reference', 'both'].includes(laneArg)) {
    fail(`agent-bench: --lane must be rifty|local-reference|both, got '${laneArg}'`);
  }

  let config: BenchConfig = loadConfig(values.config);

  let mockClose: (() => Promise<void>) | null = null;
  if (values['mock-model']) {
    const mock = await startMockModelServer();
    mockClose = mock.close;
    // The mock ignores auth; the placeholder satisfies pi's "auth configured" check.
    process.env[MOCK_ENV_KEY] = 'agent-bench-mock-key';
    config = {
      ...config,
      endpoint: { baseUrl: mock.baseUrl, model: MOCK_MODEL_ID, envKey: MOCK_ENV_KEY },
    };
    console.log(`[agent-bench] mock model endpoint at ${mock.baseUrl}`);
  }
  if (config.endpoint === null) {
    fail(
      'agent-bench: no endpoint configured — pass --config with an `endpoint` section or --mock-model',
    );
  }

  const tasks = loadTasks(values.task ? [values.task] : undefined);
  const runsPerTask = values.runs ? Number(values.runs) : config.runsPerTask;
  if (!Number.isInteger(runsPerTask) || runsPerTask <= 0) {
    fail(`agent-bench: --runs must be a positive integer, got '${values.runs}'`);
  }

  const lanes: LaneAdapter[] = [];
  if (laneArg === 'local-reference' || laneArg === 'both') {
    lanes.push(createLocalReferenceLane(config));
  }
  if (laneArg === 'rifty' || laneArg === 'both') lanes.push(createRiftyLane(config));
  const runId = makeRunId();
  const reportDir = join(BENCH_ROOT, 'reports', runId);

  try {
    const { report, reportPath } = await runBench({
      config,
      lanes,
      tasks,
      runsPerTask,
      runId,
      reportDir,
      dryJudge: values['dry-judge'] as boolean,
    });
    const counts = { pass: 0, fail: 0, 'budget-exceeded': 0, 'not-judged': 0 };
    for (const run of report.runs) {
      if (run.outcome === null) counts['not-judged'] += 1;
      else counts[run.outcome] += 1;
    }
    console.log(
      `[agent-bench] done: pass=${counts.pass} fail=${counts.fail} budget-exceeded=${counts['budget-exceeded']} not-judged=${counts['not-judged']}`,
    );
    console.log(`[agent-bench] report: ${reportPath}`);
  } finally {
    for (const lane of lanes) {
      if (lane.dispose) await lane.dispose();
    }
    if (mockClose) await mockClose();
  }
}

async function main(): Promise<void> {
  let argv = process.argv.slice(2);
  // `pnpm agent-bench -- <args>` forwards the literal `--` separator.
  if (argv[0] === '--') argv = argv.slice(1);
  if (argv[0] === '--help' || argv[0] === '-h') {
    console.log(USAGE);
    return;
  }
  if (argv[0] === 'report') {
    const dir = argv[1];
    if (!dir) fail('agent-bench: report needs a directory: agent-bench report <dir>');
    const summaryPath = regenerateSummary(dir);
    console.log(`[agent-bench] regenerated ${summaryPath}`);
    return;
  }
  // `run` prefix optional: `agent-bench --lane ...` == `agent-bench run --lane ...`
  await runCommand(argv[0] === 'run' ? argv.slice(1) : argv);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
