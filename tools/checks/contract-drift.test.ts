import { describe, expect, it } from 'vitest';
import { evaluate, statusOf } from './contract-drift.mjs';

const item = (status: string) => `---\narea: playground\nstatus: ${status}\ntitle: T\n---\n\nbody`;

const read = (base: string | null, head: string | null) => (_path: string, side: 'base' | 'head') =>
  side === 'base' ? base : head;

const readyEpic = `---
kind: epic
status: ready
title: E
items: [playground/x, playground/y]
---

## Items

1. \`playground/x\` — **x-slice**: close me.
2. \`playground/y\` — **y-slice**: keep me.

## Budget

| slice | band |
|---|---|
| x-slice | 10–20 |
| y-slice | 20–30 |
`;

const readyEpicAfterX = `---
kind: epic
status: ready
title: E
items: [playground/y]
---

## Items

2. \`playground/y\` — **y-slice**: keep me.

## Budget

| slice | band |
|---|---|
| y-slice | 20–30 |
`;

describe('statusOf', () => {
  it('reads frontmatter status, null without one', () => {
    expect(statusOf(item('ready'))).toBe('ready');
    expect(statusOf('no frontmatter')).toBeNull();
    expect(statusOf(null as unknown as string)).toBeNull();
  });
});

describe('evaluate', () => {
  const src = { status: 'M', path: 'packages/vfs/src/index.ts' };
  const contract = { status: 'M', path: 'docs/backlog/playground/x.md' };

  it('flags an in-place ready-contract edit alongside source changes', () => {
    const v = evaluate([src, contract], read(item('ready'), item('ready')));
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('docs/backlog/playground/x.md');
  });

  it('flags a ready→draft demotion alongside source changes', () => {
    expect(evaluate([src, contract], read(item('ready'), item('draft')))).toHaveLength(1);
  });

  it('passes draft edits, docs-only diffs, adds, and deletes', () => {
    expect(evaluate([src, contract], read(item('draft'), item('draft')))).toHaveLength(0);
    expect(evaluate([contract], read(item('ready'), item('ready')))).toHaveLength(0);
    expect(evaluate([src, { ...contract, status: 'A' }], read(null, item('ready')))).toHaveLength(
      0,
    );
    expect(evaluate([src, { ...contract, status: 'D' }], read(item('ready'), null))).toHaveLength(
      0,
    );
  });

  it('guards in-progress epics, skips README/TEMPLATE', () => {
    const epic = { status: 'M', path: 'docs/backlog/epics/e.md' };
    expect(evaluate([src, epic], read(item('in-progress'), item('in-progress')))).toHaveLength(1);
    const readme = { status: 'M', path: 'docs/backlog/README.md' };
    expect(evaluate([src, readme], read(item('ready'), item('ready')))).toHaveLength(0);
  });

  it('allows only exact ready-epic bookkeeping removal for a deleted ready child', () => {
    const deleted = {
      status: 'D',
      path: 'docs/backlog/playground/x.md',
    };
    const epic = {
      status: 'M',
      path: 'docs/backlog/epics/e.md',
    };
    const byPath = (path: string, side: 'base' | 'head'): string | null => {
      if (path === deleted.path) {
        return side === 'base'
          ? `---
area: playground
status: ready
title: X
epic: e
---
`
          : null;
      }
      if (path === epic.path) return side === 'base' ? readyEpic : readyEpicAfterX;
      return null;
    };

    expect(evaluate([src, deleted, epic], byPath)).toEqual([]);
    const inProgress = (text: string) => text.replace('status: ready', 'status: in-progress');
    const inProgressByPath = (path: string, side: 'base' | 'head'): string | null => {
      const value = byPath(path, side);
      return path === epic.path && value !== null ? inProgress(value) : value;
    };
    expect(evaluate([src, deleted, epic], inProgressByPath)).toEqual([]);
  });

  it('still rejects wording, additions, and closure claimed by a draft deletion', () => {
    const deleted = {
      status: 'D',
      path: 'docs/backlog/playground/x.md',
    };
    const epic = {
      status: 'M',
      path: 'docs/backlog/epics/e.md',
    };
    const readyChild = `---
area: playground
status: ready
title: X
epic: e
---
`;
    const draftChild = readyChild.replace('status: ready', 'status: draft');
    const mutatedEpic = readyEpicAfterX.replace('keep me.', 'rewritten.');
    const addedEpic = readyEpicAfterX.replace(
      'items: [playground/y]',
      'items: [playground/y, playground/z]',
    );
    const withChild =
      (child: string, headEpic: string) =>
      (path: string, side: 'base' | 'head'): string | null => {
        if (path === deleted.path) return side === 'base' ? child : null;
        if (path === epic.path) return side === 'base' ? readyEpic : headEpic;
        return null;
      };

    expect(evaluate([src, deleted, epic], withChild(readyChild, mutatedEpic))).toHaveLength(1);
    expect(evaluate([src, deleted, epic], withChild(readyChild, addedEpic))).toHaveLength(1);
    expect(evaluate([src, deleted, epic], withChild(draftChild, readyEpicAfterX))).toHaveLength(1);
  });

  it('allows only deleted ready keys to leave a dependent blocked_by list', () => {
    const deleted = {
      status: 'D',
      path: 'docs/backlog/playground/x.md',
    };
    const dependent = {
      status: 'M',
      path: 'docs/backlog/playground/y.md',
    };
    const closed = `---
area: playground
status: ready
title: X
epic: e
---
`;
    const baseDependent = `---
area: playground
status: ready
title: Y
epic: e
blocked_by: [playground/x, playground/z]
---

body
`;
    const headDependent = baseDependent.replace(
      'blocked_by: [playground/x, playground/z]',
      'blocked_by: [playground/z]',
    );
    const byPath =
      (head: string) =>
      (path: string, side: 'base' | 'head'): string | null => {
        if (path === deleted.path) return side === 'base' ? closed : null;
        if (path === dependent.path) return side === 'base' ? baseDependent : head;
        return null;
      };

    expect(evaluate([src, deleted, dependent], byPath(headDependent))).toEqual([]);
    expect(
      evaluate([src, deleted, dependent], byPath(headDependent.replace('body', 'rewritten body'))),
    ).toHaveLength(1);
    expect(
      evaluate(
        [src, deleted, dependent],
        byPath(headDependent.replace('blocked_by: [playground/z]\n', '')),
      ),
    ).toHaveLength(1);
  });
});
