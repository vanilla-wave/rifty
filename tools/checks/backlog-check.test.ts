import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const checker = fileURLToPath(new URL('../backlog/check.mjs', import.meta.url));

describe('backlog:check', () => {
  it('rejects an autonomous goal without closing invariants', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-backlog-check-'));
    try {
      const epicDir = join(root, 'docs/backlog/epics');
      mkdirSync(epicDir, { recursive: true });
      writeFileSync(
        join(epicDir, 'goal.md'),
        `---
kind: epic
status: ready
title: Goal
created: 2026-07-26
value: Real package runs
tier: robust
goal_baseline: 0123456789abcdef0123456789abcdef01234567
---

## Outcome

The package runs.

## User scenario

Install and run the package.

## Items

No open items.

## Budget

No selected slices.
`,
      );

      const result = spawnSync(process.execPath, [checker], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("autonomous goal_baseline requires '## Invariants'");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
