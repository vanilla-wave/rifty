import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error plain .mjs module without type declarations
import {
  SOURCE_LANES,
  TASKS,
  classifyDiff,
  failedFiles,
  runChecks,
  selectTasks,
  workingTreePaths,
} from './pr-check.mjs';

const timeout = (file: string) => ({
  name: file,
  status: 'failed',
  assertionResults: [
    { status: 'passed', failureMessages: [] },
    { status: 'failed', failureMessages: ['Error: Test timed out in 5000ms.'] },
  ],
});
const assertion = (file: string) => ({
  name: file,
  status: 'failed',
  assertionResults: [{ status: 'failed', failureMessages: ['AssertionError: expected 1 to be 2'] }],
});
const passed = (file: string) => ({
  name: file,
  status: 'passed',
  assertionResults: [{ status: 'passed', failureMessages: [] }],
});

describe('pr:check lanes follow the diff class', () => {
  it('a documentation-only working tree skips exactly the source lanes and keeps every other check', () => {
    const paths = [
      'docs/process/rules/review.md',
      'AGENTS.md',
      'CHANGELOG.md',
      '.agents/skills/rifty-goal/SKILL.md',
      '.claude/workflows/goal-run.js',
    ];
    expect(classifyDiff(paths)).toBe('docs-only');
    const names = selectTasks(TASKS, 'docs-only').map((t: { name: string }) => t.name);
    for (const lane of SOURCE_LANES) expect(names).not.toContain(lane);
    expect(names).toEqual(
      TASKS.map((t: { name: string }) => t.name).filter((n: string) => !SOURCE_LANES.has(n)),
    );
    expect(names).toContain('backlog:check');
    expect(names).toContain('check:contract-drift');
    expect(names).toContain('lint');
  });

  it('one source path, an empty diff, or an unknown diff keeps the full gate (fail-open)', () => {
    expect(classifyDiff(['docs/adr/README.md', 'tools/checks/pr-check.mjs'])).toBe('full');
    expect(classifyDiff(['packages/vfs/src/index.ts'])).toBe('full');
    expect(classifyDiff([])).toBe('full');
    expect(classifyDiff(null)).toBe('full');
    expect(selectTasks(TASKS, 'full')).toEqual(TASKS);
  });

  describe('without an origin/main merge-base', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rifty-pr-check-'));
    afterAll(() => rmSync(cwd, { recursive: true, force: true }));
    it('reports an unknown diff instead of guessing', () => {
      execFileSync('git', ['init', '-q'], { cwd });
      expect(workingTreePaths(cwd)).toBeNull();
    });
  });
});

describe('pr:check reruns every failed file once in isolation and counts the time-outs', () => {
  it('collects each failed file with its failure and vitest time-out counts', () => {
    const report = {
      testResults: [
        passed('/r/a.test.ts'),
        timeout('/r/b.test.ts'),
        assertion('/r/c.test.ts'),
        timeout('/r/d.test.ts'),
      ],
    };
    expect(failedFiles(report)).toEqual([
      { file: '/r/b.test.ts', failed: 1, timeouts: 1 },
      { file: '/r/c.test.ts', failed: 1, timeouts: 0 },
      { file: '/r/d.test.ts', failed: 1, timeouts: 1 },
    ]);
  });

  it('keeps a suite-level failure (no assertion results) as a failed file and returns nothing without a report', () => {
    expect(
      failedFiles({
        testResults: [{ name: '/r/d.test.ts', status: 'failed', assertionResults: [] }],
      }),
    ).toEqual([{ file: '/r/d.test.ts', failed: 0, timeouts: 0 }]);
    expect(failedFiles(null)).toEqual([]);
    expect(failedFiles({})).toEqual([]);
  });

  it('runChecks replaces a failed task with the retry result and keeps the failure when retry declines', async () => {
    const fail = { name: 'x', command: 'sh', args: ['-c', 'exit 1'] };
    const replaced = await runChecks([fail], {
      retry: async (r: { name: string; output: string }) => ({
        ...r,
        code: 0,
        durationMs: 1,
        note: 'isolated rerun',
      }),
    });
    expect(replaced.ok).toBe(true);
    expect(replaced.results[0].note).toBe('isolated rerun');
    const kept = await runChecks([fail], { retry: async () => null });
    expect(kept.ok).toBe(false);
    expect(kept.results[0].code).toBe(1);
  });
});
