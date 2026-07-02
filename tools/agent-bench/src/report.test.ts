import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JudgeProbe } from './judge/context.ts';
import {
  type ReportHeader,
  type RunRecord,
  aggregateTasks,
  buildReport,
  regenerateSummary,
  renderSummaryMd,
  writeReport,
} from './report.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const HEADER: ReportHeader = {
  runId: 'test-run',
  createdAt: '2026-07-02T00:00:00.000Z',
  model: 'test-model',
  promptProfile: { 'local-reference': 'pi-baseline' },
  taskSetVersion: 'task-set-v1',
  endpoint: { baseUrl: 'http://127.0.0.1:9999/v1', envKey: 'OPENAI_API_KEY' },
  limits: { maxToolCalls: 40, runTimeoutMs: 600_000, toolTimeoutMs: 120_000 },
  runsPerTask: 3,
  laneVersions: { 'local-reference': { pi: '0.80.3', node: 'v24.0.0' } },
};

function record(overrides: Partial<RunRecord>): RunRecord {
  return {
    task: 'add-search',
    lane: 'local-reference',
    runIndex: 1,
    outcome: 'pass',
    judgeSkipped: null,
    elapsedMs: 1000,
    turns: 2,
    toolCalls: 3,
    terminalTail: '',
    finalDiff: '',
    previewProbes: [],
    trace: { artifacts: {}, agentExitCode: 0, budgetReason: null },
    failureClass: null,
    note: null,
    ...overrides,
  };
}

describe('aggregateTasks', () => {
  it('keeps budget-exceeded DISTINCT from fail (excluded from the pass-rate denominator)', () => {
    const summaries = aggregateTasks([
      record({ runIndex: 1, outcome: 'pass' }),
      record({ runIndex: 2, outcome: 'fail' }),
      record({
        runIndex: 3,
        outcome: 'budget-exceeded',
        trace: { artifacts: {}, agentExitCode: null, budgetReason: 'maxToolCalls (40) exceeded' },
      }),
    ]);
    expect(summaries).toHaveLength(1);
    const stats = summaries[0]?.perLane['local-reference'];
    expect(stats).toEqual({
      runs: 3,
      pass: 1,
      fail: 1,
      budgetExceeded: 1,
      notJudged: 0,
      passRate: 0.5, // NOT 1/3 — budget overrun is not a fail
    });
  });

  it('counts dry-judge runs as notJudged with a null pass rate', () => {
    const summaries = aggregateTasks([
      record({ outcome: null, judgeSkipped: 'dry-judge' }),
      record({ runIndex: 2, outcome: null, judgeSkipped: 'dry-judge' }),
    ]);
    const stats = summaries[0]?.perLane['local-reference'];
    expect(stats?.notJudged).toBe(2);
    expect(stats?.passRate).toBeNull();
  });

  it('computes the rifty − local delta only when both lanes were judged', () => {
    const localOnly = aggregateTasks([record({})]);
    expect(localOnly[0]?.delta).toBeNull();
    const both = aggregateTasks([
      record({ lane: 'local-reference', outcome: 'pass' }),
      record({ lane: 'rifty', outcome: 'fail' }),
    ]);
    expect(both[0]?.delta).toBe(-1);
  });
});

describe('report shape', () => {
  it('writes report.json with human fill-in fields as null and no key material', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-bench-report-'));
    tempDirs.push(dir);
    const probes: JudgeProbe[] = [{ name: 'probe', pass: false, evidence: 'expected X, saw Y' }];
    const report = buildReport(HEADER, [record({ outcome: 'fail', previewProbes: probes })]);
    const { reportPath } = writeReport(dir, report);
    const parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(parsed.header.model).toBe('test-model');
    expect(parsed.header.endpoint).toEqual({
      baseUrl: 'http://127.0.0.1:9999/v1',
      envKey: 'OPENAI_API_KEY',
    });
    expect(parsed.header.limits.maxToolCalls).toBe(40);
    expect(parsed.header.taskSetVersion).toBe('task-set-v1');
    expect(parsed.header.laneVersions['local-reference'].pi).toBe('0.80.3');
    expect(parsed.runs[0].failureClass).toBeNull();
    expect(parsed.runs[0].note).toBeNull();
    expect(parsed.runs[0].previewProbes[0].evidence).toBe('expected X, saw Y');
    // only the env var NAME is stored — never a key field/value
    expect(Object.keys(parsed.header.endpoint).sort()).toEqual(['baseUrl', 'envKey']);
    expect(JSON.stringify(parsed)).not.toMatch(/"apiKey"/);
  });

  it('regenerates summary.md from an edited report.json (human classification round-trip)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-bench-report-'));
    tempDirs.push(dir);
    const report = buildReport(HEADER, [
      record({ outcome: 'fail', failureClass: null, note: null }),
    ]);
    writeReport(dir, report);
    // Human fills failureClass/note in report.json...
    const edited = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    edited.runs[0].failureClass = 'provider';
    edited.runs[0].note = 'endpoint 500s';
    writeFileSync(join(dir, 'report.json'), JSON.stringify(edited), 'utf8');
    const summaryPath = regenerateSummary(dir);
    const summary = readFileSync(summaryPath, 'utf8');
    expect(summary).toContain('provider');
    expect(summary).toContain('endpoint 500s');
  });

  it('summary renders budget-exceeded as its own outcome and includes failure evidence', () => {
    const report = buildReport(HEADER, [
      record({ outcome: 'budget-exceeded' }),
      record({
        runIndex: 2,
        outcome: 'fail',
        previewProbes: [{ name: 'p', pass: false, evidence: 'evidence-string-42' }],
      }),
    ]);
    const summary = renderSummaryMd(report);
    expect(summary).toContain('budget-exceeded');
    expect(summary).toContain('evidence-string-42');
    expect(summary).toContain('pi:0.80.3');
  });
});
