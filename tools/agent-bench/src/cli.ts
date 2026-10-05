import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { observedSmokeModel } from '../tests/observed-smoke-model.ts';
import { loadConfig, positive, redactJson, secretValues } from './config.ts';
import type { Lane } from './lanes/types.ts';
import { resolvePlan } from './plan.ts';
import { regenerate, writeComparison } from './report.ts';
import { run } from './runner.ts';
import { loadTasks } from './tasks.ts';
const parsed = parseArgs({
  allowPositionals: true,
  options: {
    lane: { type: 'string' },
    task: { type: 'string' },
    runs: { type: 'string' },
    config: { type: 'string' },
    output: { type: 'string' },
    compare: { type: 'string' },
    'mock-model': { type: 'boolean' },
  },
});
const command = parsed.positionals[0] ?? 'run';
if (command === 'report') {
  if (!parsed.positionals[1]) throw new Error('Usage: agent-bench report <directory>');
  const directory = resolve(parsed.positionals[1]);
  const comparison = parsed.values.compare
    ? await writeComparison(directory, resolve(parsed.values.compare))
    : undefined;
  await regenerate(directory);
  if (comparison?.regressions.length) process.exitCode = 1;
} else if (command === 'run' || command === 'plan') {
  const config = await loadConfig(parsed.values.config);
  if (parsed.values.runs) config.runsPerTask = positive(Number(parsed.values.runs), 'runs');
  const lane = parsed.values.lane ?? 'all';
  const valid: Lane[] = ['rifty', 'rifty-no-coi', 'local-reference'];
  if (lane !== 'all' && !valid.includes(lane as Lane)) throw new Error(`Unknown lane ${lane}`);
  const all = await loadTasks();
  const tasks = parsed.values.task ? all.filter((task) => task.id === parsed.values.task) : all;
  if (!tasks.length) throw new Error(`Unknown task ${parsed.values.task}`);
  if (command === 'plan') {
    const plan = await resolvePlan(config, tasks, lane === 'all' ? valid : [lane as Lane]);
    plan.config = JSON.parse(
      redactJson(config, config.endpoint ? secretValues(config.endpoint) : []),
    ) as typeof config;
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
  }
  const mock = parsed.values['mock-model'] ? await observedSmokeModel() : undefined;
  try {
    if (mock)
      config.endpoint = {
        id: 'scripted',
        name: 'scripted',
        api: 'openai-completions',
        provider: 'bench',
        baseUrl: mock.baseUrl,
        contextWindow: 128000,
        maxTokens: 8192,
        input: ['text'],
        reasoning: false,
        thinking: 'off',
        compat: {},
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
    await run(
      config,
      tasks,
      lane === 'all' ? valid : [lane as Lane],
      resolve(
        parsed.values.output ??
          `tools/agent-bench/reports/${new Date().toISOString().replaceAll(':', '-')}`,
      ),
    );
  } finally {
    await mock?.close();
  }
} else throw new Error(`Unknown command ${command}`);
