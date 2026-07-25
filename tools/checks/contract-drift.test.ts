import { describe, expect, it } from 'vitest';
import { closeEpicItems, closeItemDependencies, evaluate, statusOf } from './contract-drift.mjs';

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

const readyEpicAfterX = readyEpic.replace(
  'items: [playground/x, playground/y]',
  'items: [playground/y]',
);

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

  it('rejects an implementation diff that edits its own process referee', () => {
    const src = { status: 'M', path: 'packages/vfs/src/index.ts' };
    for (const path of [
      'tools/checks/budget.mjs',
      'tools/checks/run-pickup.mjs',
      '.agents/skills/rifty-review-loop/review-schema.json',
    ]) {
      const referee = { status: 'M', path };
      expect(evaluate([src, referee], read(null, null))[0]).toContain('own process referee');
      expect(evaluate([referee], read(null, null))).toEqual([]);
    }
  });

  it('allows only exact bookkeeping subtraction for a deleted ready child', () => {
    const src = { status: 'M', path: 'packages/vfs/src/index.ts' };
    const deleted = { status: 'D', path: 'docs/backlog/playground/x.md' };
    const epicEntry = { status: 'M', path: 'docs/backlog/epics/e.md' };
    const child = `---
area: playground
status: ready
title: X
epic: e
---
`;
    const byPath = (path: string, side: 'base' | 'head'): string | null => {
      if (path === deleted.path) return side === 'base' ? child : null;
      if (path === epicEntry.path) return side === 'base' ? readyEpic : readyEpicAfterX;
      return null;
    };

    expect(evaluate([src, deleted, epicEntry], byPath)).toEqual([]);
    expect(
      evaluate([src, deleted, epicEntry], (path, side) =>
        path === epicEntry.path && side === 'head'
          ? readyEpicAfterX.replace('keep me.', 'rewritten.')
          : byPath(path, side),
      ),
    ).toHaveLength(1);
  });
});

describe('closure bookkeeping transforms', () => {
  it('subtracts only the exact frontmatter child key', () => {
    expect(closeEpicItems(readyEpic, ['playground/x'])).toBe(readyEpicAfterX);
    expect(closeEpicItems(readyEpic, ['playground/missing'])).toBeNull();
  });

  it('preserves bullet-form Items, multiline prose, and historical Budget rows', () => {
    const withFinal = readyEpic.replace(
      '2. `playground/y` — **y-slice**: keep me.',
      '- `playground/y` — delete me.\n  Continuation owned by y.\n\nRun-level prose.',
    );
    const expected = withFinal.replace(
      'items: [playground/x, playground/y]',
      'items: [playground/x]',
    );
    expect(closeEpicItems(withFinal, ['playground/y'])).toBe(expected);
  });

  it('subtracts only closed keys from blocked_by', () => {
    const dependent = `---
area: playground
status: ready
blocked_by: [playground/x, playground/z]
---
`;
    expect(closeItemDependencies(dependent, ['playground/x'])).toBe(
      dependent.replace('blocked_by: [playground/x, playground/z]', 'blocked_by: [playground/z]'),
    );
  });
});
