import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('validates dir-format epics: retired marker, ready shape, sibling files', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-backlog-check-'));
    try {
      const goalDir = join(root, 'docs/backlog/epics/e');
      mkdirSync(goalDir, { recursive: true });
      writeFileSync(
        join(goalDir, 'goal.md'),
        `---
kind: epic
status: ready
title: Goal
created: 2026-08-23
value: Real package runs
tier: robust
goal_baseline: 0123456789abcdef0123456789abcdef01234567
---

## Outcome

The package runs.

## User scenario

Install and run the package.

## Invariants

- I1. It runs.
`,
      );

      const result = spawnSync(process.execPath, [checker], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('goal_baseline marker is retired');
      expect(result.stderr).toContain('ready goal requires map.md beside goal.md');
      expect(result.stderr).toContain('ready goal requires ledger.md beside goal.md');

      writeFileSync(join(goalDir, 'map.md'), '## Items\n\n## Open questions\n');
      writeFileSync(join(goalDir, 'ledger.md'), '# Ledger\n');
      const goal = readFileSync(join(goalDir, 'goal.md'), 'utf8');
      writeFileSync(
        join(goalDir, 'goal.md'),
        goal.replace('goal_baseline: 0123456789abcdef0123456789abcdef01234567\n', ''),
      );
      const green = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
      expect(green.stderr).toBe('');
      expect(green.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires ## Challenge with a verdict line on items created at/after the cutoff', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-backlog-check-'));
    try {
      const areaDir = join(root, 'docs/backlog/perf');
      mkdirSync(areaDir, { recursive: true });
      const item = join(areaDir, 'x.md');
      const frontmatter = `---
area: perf
status: draft
title: X
created: 2026-08-27
why: something slow
---

## Context

Slow.
`;
      writeFileSync(item, frontmatter);

      const missing = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain("requires '## Challenge'");

      writeFileSync(item, `${frontmatter}\n## Challenge\n\nlooks fine\n`);
      const noVerdict = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
      expect(noVerdict.status).toBe(1);
      expect(noVerdict.stderr).toContain("missing 'challenge: <YYYY-MM-DD> — <verdict>' line");

      writeFileSync(item, `${frontmatter}\n## Challenge\n\nchallenge: 2026-08-27 — clear\n`);
      const green = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
      expect(green.stderr).toBe('');
      expect(green.status).toBe(0);

      // grandfathered: created before the cutoff needs no challenge
      writeFileSync(item, frontmatter.replace('created: 2026-08-27', 'created: 2026-08-26'));
      const old = spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
      expect(old.stderr).toBe('');
      expect(old.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
