/**
 * Lane-agnostic runner: N cold-start runs per task per lane; judges each run
 * with the task's judge.ts over a fresh Playwright page; emits RunRecords.
 * `--dry-judge` (pass-A scaffolding) skips ONLY page-based judging and records
 * what would be judged — everything else runs for real.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser } from '@playwright/test';
import type { BenchConfig } from './config.ts';
import type { JudgeContext, JudgeVerdict, TaskJudge } from './judge/context.ts';
import type { LaneAdapter, PreparedRun } from './lanes/types.ts';
import {
  type BenchReport,
  type ReportHeader,
  type RunRecord,
  buildReport,
  writeReport,
} from './report.ts';
import type { BenchTask } from './tasks.ts';

export interface BenchRunOptions {
  /** endpoint must be resolved (config file or --mock-model) before running. */
  config: BenchConfig;
  lanes: LaneAdapter[];
  tasks: BenchTask[];
  runsPerTask: number;
  runId: string;
  /** reports/<run-id> — report.json, summary.md and per-run artifacts land here. */
  reportDir: string;
  dryJudge: boolean;
  log?: (line: string) => void;
}

async function loadJudge(task: BenchTask): Promise<TaskJudge> {
  const judgePath = join(task.taskDir, 'judge.ts');
  const mod = (await import(pathToFileURL(judgePath).href)) as { judge?: unknown };
  if (typeof mod.judge !== 'function') {
    throw new Error(`agent-bench: ${judgePath} must export a \`judge(ctx)\` function`);
  }
  return mod.judge as TaskJudge;
}

async function judgeRun(
  browser: Browser,
  task: BenchTask,
  prepared: PreparedRun,
): Promise<JudgeVerdict> {
  const judge = await loadJudge(task);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const ctx: JudgeContext = {
      previewUrl: prepared.previewUrl,
      page,
      readFile: (relPath) => prepared.readFile(relPath),
      gitDiff: () => prepared.gitDiff(),
      terminalTail: () => prepared.terminalTail(),
    };
    return await judge(ctx);
  } finally {
    await context.close();
  }
}

export async function runBench(
  opts: BenchRunOptions,
): Promise<{ report: BenchReport; reportPath: string }> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const endpoint = opts.config.endpoint;
  if (endpoint === null) {
    throw new Error('agent-bench: runBench requires a resolved endpoint (config or --mock-model)');
  }

  const promptProfile: Record<string, string> = {};
  const laneVersions: Record<string, Record<string, string>> = {};
  for (const lane of opts.lanes) {
    promptProfile[lane.id] = lane.promptProfile;
    laneVersions[lane.id] = await lane.laneVersions();
  }

  let browser: Browser | null = null;
  const records: RunRecord[] = [];
  try {
    for (const lane of opts.lanes) {
      for (const task of opts.tasks) {
        for (let runIndex = 1; runIndex <= opts.runsPerTask; runIndex += 1) {
          const runDir = join(opts.reportDir, 'runs', task.slug, lane.id, `run-${runIndex}`);
          mkdirSync(runDir, { recursive: true });
          log(`[agent-bench] ${lane.id} / ${task.slug} / run ${runIndex}: preparing (cold start)`);
          const prepared = await lane.prepare(task, runDir);
          try {
            const startedAt = Date.now();
            await prepared.sendPrompt(task.prompt);
            const runOutcome = await prepared.waitDone();
            const elapsedMs = Date.now() - startedAt;
            const trace = await prepared.collectTrace();
            const terminalTail = await prepared.terminalTail();
            const finalDiff = await prepared.gitDiff();

            let outcome: RunRecord['outcome'];
            let judgeSkipped: RunRecord['judgeSkipped'] = null;
            let probes: RunRecord['previewProbes'] = [];
            const artifacts = { ...trace.artifacts };
            if (runOutcome === 'budget-exceeded') {
              outcome = 'budget-exceeded';
            } else if (opts.dryJudge) {
              judgeSkipped = 'dry-judge';
              outcome = null;
              const planPath = join(runDir, 'dry-judge-plan.json');
              writeFileSync(
                planPath,
                `${JSON.stringify(
                  {
                    task: task.slug,
                    judgeFile: join(task.taskDir, 'judge.ts'),
                    previewUrl: prepared.previewUrl,
                    workspace: prepared.workspace,
                    wouldJudge: true,
                  },
                  null,
                  2,
                )}\n`,
                'utf8',
              );
              artifacts.dryJudgePlan = planPath;
              log(
                `[agent-bench] dry-judge: would run ${task.slug}/judge.ts against ${prepared.previewUrl}`,
              );
            } else {
              if (!browser) {
                const { chromium } = await import('@playwright/test');
                browser = await chromium.launch();
              }
              const verdict = await judgeRun(browser, task, prepared);
              probes = verdict.probes;
              outcome = verdict.pass ? 'pass' : 'fail';
            }

            records.push({
              task: task.slug,
              lane: lane.id,
              runIndex,
              outcome,
              judgeSkipped,
              elapsedMs,
              turns: trace.turns,
              toolCalls: trace.toolCalls,
              terminalTail,
              finalDiff,
              previewProbes: probes,
              trace: {
                artifacts,
                agentExitCode: trace.agentExitCode,
                budgetReason: trace.budgetReason,
              },
              failureClass: null,
              note: null,
            });
            log(
              `[agent-bench] ${lane.id} / ${task.slug} / run ${runIndex}: ${outcome ?? 'not judged (dry-judge)'} in ${(elapsedMs / 1000).toFixed(1)}s (turns=${trace.turns}, toolCalls=${trace.toolCalls})`,
            );
          } finally {
            await prepared.cleanup();
          }
        }
      }
    }
  } finally {
    if (browser) await (browser as Browser).close();
  }

  const header: ReportHeader = {
    runId: opts.runId,
    createdAt: new Date().toISOString(),
    model: endpoint.model,
    promptProfile,
    taskSetVersion: opts.config.taskSetVersion,
    endpoint: { baseUrl: endpoint.baseUrl, envKey: endpoint.envKey },
    limits: opts.config.limits,
    runsPerTask: opts.runsPerTask,
    laneVersions,
  };
  const report = buildReport(header, records);
  const { reportPath } = writeReport(opts.reportDir, report);
  return { report, reportPath };
}
