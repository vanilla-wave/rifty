/**
 * Parity invariant: the prompt each lane's sendPrompt receives is the exact
 * task.prompt string, byte-identical to what any other lane would get. Tested
 * through the real runner with a capturing fake lane (dry-judge, no browser).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';
import type { LaneAdapter, PreparedRun, RunOutcome } from './lanes/types.ts';
import type { BenchReport } from './report.ts';
import { runBench } from './runner.ts';
import { loadTasks } from './tasks.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function capturingLane(
  captured: { lane: string; task: string; prompt: string }[],
  id: 'local-reference' | 'rifty',
  outcome: RunOutcome = 'done',
): LaneAdapter {
  return {
    id,
    promptProfile: id === 'rifty' ? 'pi-baseline+rifty-adapter-v1' : 'pi-baseline',
    async laneVersions() {
      return { pi: '0.80.3', fake: 'yes' };
    },
    async prepare(task, _runDir): Promise<PreparedRun> {
      return {
        workspace: '/fake/workspace',
        previewUrl: 'http://127.0.0.1:1/',
        async sendPrompt(text: string) {
          captured.push({ lane: id, task: task.slug, prompt: text });
        },
        async waitDone() {
          return outcome;
        },
        async collectTrace() {
          return {
            turns: 1,
            toolCalls: 2,
            artifacts: {},
            agentExitCode: 0,
            budgetReason: outcome === 'budget-exceeded' ? 'runTimeoutMs (1ms) exceeded' : null,
          };
        },
        async terminalTail() {
          return 'tail';
        },
        async gitDiff() {
          return 'diff --git a/x b/x';
        },
        async readFile() {
          return '';
        },
        async cleanup() {},
      };
    },
  };
}

const CONFIG = parseConfig(
  { endpoint: { baseUrl: 'http://127.0.0.1:1/v1', model: 'fake-model' } },
  {},
);

describe('runBench', () => {
  it('delivers task.prompt byte-identical to every lane sendPrompt', async () => {
    const captured: { lane: string; task: string; prompt: string }[] = [];
    const reportDir = mkdtempSync(join(tmpdir(), 'agent-bench-run-'));
    tempDirs.push(reportDir);
    const tasks = loadTasks();
    await runBench({
      config: CONFIG,
      lanes: [capturingLane(captured, 'local-reference'), capturingLane(captured, 'rifty')],
      tasks,
      runsPerTask: 1,
      runId: 'test',
      reportDir,
      dryJudge: true,
      log: () => {},
    });
    expect(captured).toHaveLength(tasks.length * 2);
    for (const task of tasks) {
      const delivered = captured.filter((c) => c.task === task.slug);
      expect(delivered).toHaveLength(2);
      for (const d of delivered) {
        expect(
          Buffer.from(d.prompt, 'utf8').equals(Buffer.from(task.prompt, 'utf8')),
          `${d.lane}/${task.slug}`,
        ).toBe(true);
      }
    }
  });

  it('dry-judge records a plan instead of judging and writes the report', async () => {
    const captured: { lane: string; task: string; prompt: string }[] = [];
    const reportDir = mkdtempSync(join(tmpdir(), 'agent-bench-run-'));
    tempDirs.push(reportDir);
    const { report, reportPath } = await runBench({
      config: CONFIG,
      lanes: [capturingLane(captured, 'local-reference')],
      tasks: loadTasks(['node-endpoint']),
      runsPerTask: 2,
      runId: 'test',
      reportDir,
      dryJudge: true,
      log: () => {},
    });
    expect(existsSync(reportPath)).toBe(true);
    expect(existsSync(join(reportDir, 'summary.md'))).toBe(true);
    expect(report.runs).toHaveLength(2);
    for (const run of report.runs) {
      expect(run.outcome).toBeNull();
      expect(run.judgeSkipped).toBe('dry-judge');
      const planPath = run.trace.artifacts.dryJudgePlan;
      expect(planPath).toBeDefined();
      const plan = JSON.parse(readFileSync(planPath as string, 'utf8'));
      expect(plan.task).toBe('node-endpoint');
      expect(plan.judgeFile).toMatch(/node-endpoint\/judge\.ts$/);
      expect(plan.wouldJudge).toBe(true);
    }
  });

  it('budget-exceeded runs are recorded as budget-exceeded and never judged', async () => {
    const captured: { lane: string; task: string; prompt: string }[] = [];
    const reportDir = mkdtempSync(join(tmpdir(), 'agent-bench-run-'));
    tempDirs.push(reportDir);
    const { report } = await runBench({
      config: CONFIG,
      lanes: [capturingLane(captured, 'local-reference', 'budget-exceeded')],
      tasks: loadTasks(['add-search']),
      runsPerTask: 1,
      runId: 'test',
      reportDir,
      dryJudge: false, // even with judging ON, a budget overrun must skip the judge
      log: () => {},
    });
    expect(report.runs[0]?.outcome).toBe('budget-exceeded');
    expect(report.runs[0]?.trace.budgetReason).toMatch(/runTimeoutMs/);
    expect(report.tasks[0]?.perLane['local-reference']?.budgetExceeded).toBe(1);
    expect(report.tasks[0]?.perLane['local-reference']?.passRate).toBeNull();
  });

  it('report header carries model, profiles, task set, endpoint (env key name only) and lane versions', async () => {
    const captured: { lane: string; task: string; prompt: string }[] = [];
    const reportDir = mkdtempSync(join(tmpdir(), 'agent-bench-run-'));
    tempDirs.push(reportDir);
    const { report } = await runBench({
      config: CONFIG,
      lanes: [capturingLane(captured, 'local-reference')],
      tasks: loadTasks(['fix-date-sort']),
      runsPerTask: 1,
      runId: 'header-test',
      reportDir,
      dryJudge: true,
      log: () => {},
    });
    const parsed: BenchReport = JSON.parse(readFileSync(join(reportDir, 'report.json'), 'utf8'));
    expect(parsed.header.runId).toBe('header-test');
    expect(parsed.header.model).toBe('fake-model');
    expect(parsed.header.promptProfile['local-reference']).toBe('pi-baseline');
    expect(parsed.header.taskSetVersion).toBe('task-set-v1');
    expect(parsed.header.endpoint).toEqual({
      baseUrl: 'http://127.0.0.1:1/v1',
      envKey: 'OPENAI_API_KEY',
    });
    expect(parsed.header.laneVersions['local-reference']?.pi).toBe('0.80.3');
  });
});
