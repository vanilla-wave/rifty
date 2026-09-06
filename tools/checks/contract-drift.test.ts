import { describe, expect, it } from 'vitest';
import { evaluate, itemContract, statusOf } from './contract-drift.mjs';

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

  const traced = (rows: string, decisions = '') => `---
area: playground
status: ready
title: T
---

## Acceptance

${rows}

## Decisions

${verdict}${decisions}`;
  const recut = 're-cut: 2026-09-02 — dropped exactness demand — trace: none\n';
  const fork = 're-cut: 2026-09-02 — fork: byte-identical dropped — trace: I1\n';

  it('flags an aggregate ready-contract rewrite beside source changes without a re-cut line', () => {
    const violations = evaluate(
      [src, contract],
      read(traced('1. exact bytes → I1'), traced('1. roughly equal bytes → I1')),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('without a re-cut line');
    expect(violations[0]).toContain('docs/backlog/playground/x.md');
  });

  it('allows a re-cut of untraced or rule-traced rows when a re-cut line is recorded (RDY-5)', () => {
    const base = traced('1. exact bytes → I1\n2. stream order pinned → REV-7\n3. hardening note');
    const head = traced('1. exact bytes → I1', recut);
    expect(evaluate([src, contract], read(base, head))).toHaveLength(0);
    expect(evaluate([src, contract], read(base, traced('1. exact bytes → I1')))).toHaveLength(1);
  });

  it('lets a user-traced row change land with a re-cut line — the fork discipline is review-owned (RDY-5, REV-10 axis 3)', () => {
    const base = traced('1. exact bytes → I1\n   wrapped continuation\n2. opener works → scenario');
    expect(
      evaluate([src, contract], read(base, traced('2. opener works → scenario', recut))),
    ).toHaveLength(0);
    expect(
      evaluate([src, contract], read(base, traced('2. opener works → scenario', fork))),
    ).toHaveLength(0);
    expect(
      evaluate([src, contract], read(base, traced('2. opener works → scenario'))),
    ).toHaveLength(1);
  });

  it('compares only the graded contract: journal lines, Context and frontmatter path are free', () => {
    const base = traced('1. exact bytes → I1');
    const journal = traced(
      '1. exact bytes → I1',
      'review: checkpoints\nfinal-green: PASS @ def\n- 2026-09-05 — reception: rejected deeper mutant (I1 states bytes only)\nstop: STOP-1a — drop row 2?\n',
    );
    expect(evaluate([src, contract], read(base, journal))).toHaveLength(0);
    expect(
      evaluate(
        [src, contract],
        read(`${base}\n## Context\n\nold\n`, `${base}\n## Context\n\nnew\n`),
      ),
    ).toHaveLength(0);
    expect(itemContract(base)).toBe(itemContract(journal));
    const blockedBase = base.replace(
      'title: T\n',
      'title: T\nblocked_by: [playground/x, playground/z]\n',
    );
    const blockedHead = base.replace('title: T\n', 'title: T\nblocked_by: [playground/z]\n');
    expect(evaluate([src, contract], read(blockedBase, blockedHead))).toHaveLength(0);
    expect(evaluate([src, contract], read(blockedBase, base))).toHaveLength(0);
  });

  it('accepts a bulleted or backticked re-cut line', () => {
    const base = traced('1. exact bytes → I1\n2. hardening note');
    const bulleted = traced(
      '1. exact bytes → I1',
      '- re-cut: 2026-09-02 — dropped the note — trace: none\n',
    );
    expect(evaluate([src, contract], read(base, bulleted))).toHaveLength(0);
  });

  it('lets an ordinary unit flip ready beside source without a Contract+RED verdict (RDY-8)', () => {
    expect(
      evaluate([src, contract], read(item('draft'), `${item('ready')}review: ordinary\n`)),
    ).toHaveLength(0);
    expect(
      evaluate([src, contract], read(item('draft'), `${item('ready')}- review: ordinary\n`)),
    ).toHaveLength(0);
    expect(
      evaluate([src, contract], read(item('draft'), `${item('ready')}review: checkpoints\n`)),
    ).toHaveLength(1);
  });

  it('flags an in-place ready→in-progress edit as a rewrite', () => {
    expect(evaluate([src, contract], read(item('ready'), item('in-progress')))).toHaveLength(1);
  });

  it('allows head equal to merge-base modulo lineage lines', () => {
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

  it('guards frozen fields of a dir-format goal.md beside source; map/ledger stay free', () => {
    const goal = { status: 'M', path: 'docs/backlog/epics/e/goal.md' };
    const frozen = evaluate([src, goal], read(epic('ready'), epic('ready', 'Rewritten.')));
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toBe('docs/backlog/epics/e/goal.md: frozen Outcome changed beside source');
    expect(
      evaluate([src, goal], read(epic('ready'), epic('ready', 'Ship it.', 'closed.'))),
    ).toHaveLength(0);
    const map = { status: 'M', path: 'docs/backlog/epics/e/map.md' };
    expect(evaluate([src, map], read('## Items\n\n1. a\n', '## Items\n\n1. b\n'))).toHaveLength(0);
  });

  it('skips README/TEMPLATE', () => {
    const readme = { status: 'M', path: 'docs/backlog/README.md' };
    expect(evaluate([src, readme], read(item('ready'), `${item('ready')} rewritten`))).toHaveLength(
      0,
    );
  });

  it('rejects a process referee changed anywhere in the implementation PR', () => {
    for (const path of [
      'tools/checks/contract-drift.mjs',
      'tools/checks/run-pickup.mjs',
      'tools/review/review-schema.json',
    ]) {
      const referee = { status: 'M', path };
      expect(evaluate([src], read(null, null), [src, referee])[0]).toContain('own process referee');
      expect(evaluate([referee], read(null, null))).toEqual([]);
    }
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
