import { describe, expect, it } from 'vitest';
import { closeItemDependencies, evaluate, statusOf } from './contract-drift.mjs';

const item = (status: string) => `---\narea: playground\nstatus: ${status}\ntitle: T\n---\n\nbody`;

const read = (base: string | null, head: string | null) => (_path: string, side: 'base' | 'head') =>
  side === 'base' ? base : head;

const readyEpic = `---
kind: epic
status: ready
title: E
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

const closedChild = `---
area: playground
status: ready
title: X
epic: e
---
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
    const violations = evaluate([src, contract], read(item('ready'), item('ready')));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('docs/backlog/playground/x.md');
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

  it('guards in-progress epics and skips README/TEMPLATE', () => {
    const epic = { status: 'M', path: 'docs/backlog/epics/e.md' };
    expect(evaluate([src, epic], read(item('in-progress'), item('in-progress')))).toHaveLength(1);
    const readme = { status: 'M', path: 'docs/backlog/README.md' };
    expect(evaluate([src, readme], read(item('ready'), item('ready')))).toHaveLength(0);
  });

  it('rejects a process referee changed anywhere in the implementation PR', () => {
    for (const path of [
      'tools/checks/budget.mjs',
      'tools/checks/run-pickup.mjs',
      'tools/review/review-schema.json',
    ]) {
      const referee = { status: 'M', path };
      expect(evaluate([src], read(null, null), [src, referee])[0]).toContain('own process referee');
      expect(evaluate([referee], read(null, null))).toEqual([]);
    }
  });

  it('closes a child without rewriting the historical epic ledger', () => {
    const deleted = { status: 'D', path: 'docs/backlog/playground/x.md' };
    const epicEntry = { status: 'M', path: 'docs/backlog/epics/e.md' };
    const byPath =
      (headEpic: string) =>
      (path: string, side: 'base' | 'head'): string | null => {
        if (path === deleted.path) return side === 'base' ? closedChild : null;
        if (path === epicEntry.path) return side === 'base' ? readyEpic : headEpic;
        return null;
      };

    expect(evaluate([src, deleted], byPath(readyEpic))).toEqual([]);
    expect(
      evaluate([src, deleted, epicEntry], byPath(readyEpic.replace('keep me.', 'rewritten.'))),
    ).toHaveLength(1);
  });

  it('allows only deleted ready keys to leave a dependent blocked_by list', () => {
    const deleted = { status: 'D', path: 'docs/backlog/playground/x.md' };
    const dependent = { status: 'M', path: 'docs/backlog/playground/y.md' };
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
        if (path === deleted.path) return side === 'base' ? closedChild : null;
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

describe('closure bookkeeping transforms', () => {
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

describe('synthetic merge ref (CI)', () => {
  it('honors in-PR commit sequencing via the event head, blind without it', async () => {
    const { execFileSync, spawnSync } = await import('node:child_process');
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = mkdtempSync(join(tmpdir(), 'rifty-drift-merge-'));
    const g = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=R', '-c', 'user.email=r@e.t', ...args], {
        cwd: root,
        encoding: 'utf8',
      });
    try {
      mkdirSync(join(root, 'docs/backlog/net'), { recursive: true });
      mkdirSync(join(root, 'packages/x/src'), { recursive: true });
      writeFileSync(join(root, 'docs/backlog/net/x.md'), item('draft'));
      writeFileSync(join(root, 'packages/x/src/a.ts'), 'export const a = 1;\n');
      g('init', '-b', 'main');
      g('add', '.');
      g('commit', '-m', 'base');
      g('update-ref', 'refs/remotes/origin/main', g('rev-parse', 'HEAD').trim());
      g('checkout', '-b', 'pr');
      writeFileSync(join(root, 'docs/backlog/net/x.md'), item('ready'));
      g('add', '.');
      g('commit', '-m', 'contract flip first');
      writeFileSync(join(root, 'packages/x/src/a.ts'), 'export const a = 2;\n');
      g('add', '.');
      g('commit', '-m', 'source second');
      const prSha = g('rev-parse', 'HEAD').trim();
      g('checkout', 'main');
      g('merge', '--no-ff', '--no-edit', 'pr');
      const eventPath = join(root, 'event.json');
      writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { sha: prSha } } }));
      const script = fileURLToPath(new URL('./contract-drift.mjs', import.meta.url));
      const blind = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_PATH: undefined },
      });
      expect(blind.status).toBe(1);
      expect(blind.stderr).toContain('beside source');
      const sighted = execFileSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
      });
      expect(sighted).toContain('contract-drift: OK');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
