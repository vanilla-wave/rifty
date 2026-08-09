import { describe, expect, it } from 'vitest';
import { closeItemDependencies, evaluate, statusOf } from './contract-drift.mjs';

const item = (status: string) =>
  `---\narea: playground\nstatus: ${status}\ntitle: T\n---\n\nbody\n`;
const verdict = 'ready-verdict: 2026-08-01 — Contract+RED @ abc\n';

const read = (base: string | null, head: string | null) => (_path: string, side: 'base' | 'head') =>
  side === 'base' ? base : head;

const epic = (status: string, outcome = 'Ship it.', items = 'close me.') => `---
kind: epic
status: ${status}
value: V
tier: 1
title: E
---

## Outcome

${outcome}

## User scenario

Run it.

## Invariants

Hold.

## Items

1. \`playground/x\` — **x-slice**: ${items}

## Budget

| slice | band |
|---|---|
| x-slice | 10–20 |
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

  it('flags an aggregate ready-contract rewrite beside source changes', () => {
    const violations = evaluate([src, contract], read(item('ready'), `${item('ready')} rewritten`));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('content must match merge-base');
    expect(violations[0]).toContain('docs/backlog/playground/x.md');
  });

  it('flags an in-place ready→in-progress edit as a rewrite', () => {
    expect(evaluate([src, contract], read(item('ready'), item('in-progress')))).toHaveLength(1);
  });

  it('allows head equal to merge-base modulo ready-verdict lines', () => {
    expect(evaluate([src, contract], read(item('ready'), item('ready')))).toHaveLength(0);
    expect(evaluate([src, contract], read(item('ready'), item('ready') + verdict))).toHaveLength(0);
    expect(evaluate([src, contract], read(item('ready') + verdict, item('ready')))).toHaveLength(0);
  });

  it('requires a recorded verdict for a ready flip beside source', () => {
    const flipped = evaluate([src, contract], read(item('draft'), item('ready')));
    expect(flipped).toHaveLength(1);
    expect(flipped[0]).toContain('ready flip without pickup Contract+RED verdict');
    expect(evaluate([src, contract], read(item('draft'), item('ready') + verdict))).toHaveLength(0);
    const added = { ...contract, status: 'A' };
    expect(evaluate([src, added], read(null, item('in-progress')))).toHaveLength(1);
    expect(evaluate([src, added], read(null, item('ready') + verdict))).toHaveLength(0);
  });

  it('passes draft edits, docs-only diffs, demotions, and deletes', () => {
    expect(evaluate([src, contract], read(item('draft'), `${item('draft')} edited`))).toHaveLength(
      0,
    );
    expect(evaluate([contract], read(item('ready'), `${item('ready')} rewritten`))).toHaveLength(0);
    expect(evaluate([src, contract], read(item('ready'), item('draft')))).toHaveLength(0);
    expect(evaluate([src, { ...contract, status: 'D' }], read(item('ready'), null))).toHaveLength(
      0,
    );
  });

  it.each([
    'packages/x/src/a.test.ts',
    'packages/x/tests/a.ts',
    'packages/npm-client/src/_test-fixtures/tar-builder.ts',
    'packages/workbench/src/workers/test-fixtures/durable-owner-fs.ts',
    'apps/playground/src/glue/test-monaco-editor.ts',
    'packages/runtime-wasi/src/syscalls/fd-test-fixture.ts',
  ])('does not treat test support as implementation source: %s', (path) => {
    expect(
      evaluate(
        [{ status: 'A', path }, contract],
        read(item('ready'), `${item('ready')} rewritten`),
      ),
    ).toEqual([]);
  });

  it('guards only frozen epic fields beside source', () => {
    const epicEntry = { status: 'M', path: 'docs/backlog/epics/e.md' };
    const frozen = evaluate([src, epicEntry], read(epic('ready'), epic('ready', 'Rewritten.')));
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toBe('docs/backlog/epics/e.md: frozen Outcome changed beside source');
    expect(
      evaluate(
        [src, epicEntry],
        read(epic('in-progress'), epic('in-progress').replace('value: V', 'value: W')),
      )[0],
    ).toContain('frozen value changed beside source');
    expect(
      evaluate([src, epicEntry], read(epic('ready'), epic('ready', 'Ship it.', 'closed.'))),
    ).toHaveLength(0);
    expect(
      evaluate([src, epicEntry], read(epic('draft'), epic('draft', 'Rewritten.'))),
    ).toHaveLength(0);
  });

  it('skips README/TEMPLATE', () => {
    const readme = { status: 'M', path: 'docs/backlog/README.md' };
    expect(evaluate([src, readme], read(item('ready'), `${item('ready')} rewritten`))).toHaveLength(
      0,
    );
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
    expect(evaluate([src, deleted, dependent], byPath(headDependent + verdict))).toEqual([]);
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

describe('aggregate diff (git integration)', () => {
  it('anchors to merge-base content regardless of commit topology', async () => {
    const { execFileSync, spawnSync } = await import('node:child_process');
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = mkdtempSync(join(tmpdir(), 'rifty-drift-aggregate-'));
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
      const script = fileURLToPath(new URL('./contract-drift.mjs', import.meta.url));
      // Verdict-less flip fails even when the flip commit precedes source.
      const blind = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_PATH: undefined },
      });
      expect(blind.status).toBe(1);
      expect(blind.stderr).toContain('ready flip without pickup Contract+RED verdict');
      // Recording the verdict makes the same aggregate diff pass.
      writeFileSync(join(root, 'docs/backlog/net/x.md'), item('ready') + verdict);
      g('add', '.');
      g('commit', '-m', 'record verdict');
      const prSha = g('rev-parse', 'HEAD').trim();
      const eventPath = join(root, 'event.json');
      writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { sha: prSha } } }));
      g('checkout', 'main');
      g('merge', '--no-ff', '--no-edit', 'pr');
      const sighted = execFileSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
      });
      expect(sighted).toContain('contract-drift: OK');
      expect(sighted).toContain('vs');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
