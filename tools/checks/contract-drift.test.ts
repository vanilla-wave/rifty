import { describe, expect, it } from 'vitest';
import {
  evaluate,
  goalContract,
  itemContract,
  statusOf,
  userTracedRowCount,
} from './contract-drift.mjs';

const contract = 'docs/backlog/playground/x.md';
const item = (rows: string, decisions = '', status = 'ready') => `---
area: playground
status: ${status}
title: T
---
## Acceptance
${rows}
## Decisions
${decisions}
`;
const changes = [{ status: 'M', path: contract }];
const read = (base: string | null, head: string | null) => (_path: string, side: string) =>
  side === 'base' ? base : head;
const recut = 're-cut: 2026-09-07 — revise route — trace: none';
const fork = 're-cut: 2026-09-07 — fork: user removes byte identity — trace: I1';

describe('scope change records, independent of packaging', () => {
  it('requires a new decision for an accepted contract change', () => {
    const before = item('1. exact bytes → I1');
    expect(evaluate(changes, read(before, item('1. roughly equal → I1')))[0]).toContain(
      'without a re-cut line',
    );
    expect(evaluate(changes, read(before, item('1. same output → I1', recut)))).toEqual([]);
    // Semantic weakening is independently reviewed; the machine proves the new record exists.
    expect(
      evaluate(changes, read(item('1. exact bytes → I1', recut), item('1. changed → I1', recut))),
    ).toHaveLength(1);
  });

  it('records user scope removal, while notes can be trimmed by the agent', () => {
    const before = item('1. bytes → I1\n2. install → scenario\n3. note → REV-7');
    expect(userTracedRowCount(before)).toBe(2);
    expect(
      evaluate(changes, read(before, item('1. bytes → I1\n2. install → scenario', recut))),
    ).toEqual([]);
    expect(evaluate(changes, read(before, item('2. install → scenario', recut)))[0]).toContain(
      'without a recorded fork',
    );
    expect(evaluate(changes, read(before, item('2. install → scenario', fork)))).toEqual([]);
  });

  it('names the actual ADR when moving its obligation', () => {
    const before = item('1. bytes → I1\n2. durable → ADR-0358');
    expect(evaluate(changes, read(before, item('1. bytes → I1', recut)))[0]).toContain('ADR-0358');
    expect(
      evaluate(changes, read(before, item('1. bytes → I1', `${recut}; ADR-9999`))),
    ).toHaveLength(1);
    expect(
      evaluate(
        changes,
        read(before, item('1. bytes → I1', `${recut}; ADR-0358 moved to substrate`)),
      ),
    ).toEqual([]);
  });

  it('history and metadata are not the contract or a second proof lifecycle', () => {
    const before = item('1. bytes → I1');
    const after = `${item('1. bytes → I1', '- observed a timeout')}\n## Context\nnew observation\n`;
    expect(itemContract(before)).toBe(itemContract(after));
    expect(evaluate(changes, read(before, after))).toEqual([]);
    expect(evaluate(changes, read(item('1. bytes → I1', '', 'draft'), before))).toEqual([]);
    expect(evaluate(changes, read(before, item('1. bytes → I1', '', 'draft')))).toEqual([]);
    expect(evaluate([{ status: 'D', path: contract }], read(before, null))).toEqual([]);
    expect(statusOf(before)).toBe('ready');
    expect(statusOf(null)).toBeNull();
  });

  it.each(['docs/backlog/epics/e.md', 'docs/backlog/epics/e/goal.md'])(
    'only a new user amendment changes the accepted goal: %s',
    (path) => {
      const before =
        '---\nstatus: ready\nvalue: useful\ntier: works\n---\n## Outcome\nA\n## User scenario\nRun A\n## Invariants\n1. A works\n';
      const after = before.replace('1. A works', '1. B works');
      const entries = [{ status: 'M', path }];
      expect(evaluate(entries, read(before, after))).toHaveLength(1);
      const amendment = '\n## Decisions\namend: 2026-09-07 — user: replace A with B\n';
      expect(evaluate(entries, read(before, after + amendment))).toEqual([]);
      expect(evaluate(entries, read(before + amendment, after + amendment))).toHaveLength(1);
      expect(goalContract(before).invariants).toBe('1. A works');
      expect(evaluate(entries, read(before, `${before}\n## Items\nroute changed\n`))).toEqual([]);
    },
  );
});
