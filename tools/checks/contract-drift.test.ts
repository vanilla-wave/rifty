import { describe, expect, it } from 'vitest';
import {
  evaluate,
  itemContract,
  statusOf,
  userTracedRowCount,
  verdictArtifactPath,
} from './contract-drift.mjs';

const item = (status: string) =>
  `---\narea: playground\nstatus: ${status}\ntitle: T\n---\n\nbody\n`;
const verdict = 'ready-verdict: 2026-08-01 — Contract+RED @ abc\n';
/** A schema-shaped verdict as the runner commits it: eight axes, coverage, the unit, reviewed_sha. */
const verdictJson = (
  unit: string,
  shaPrefix = 'abc',
  checkpoint = 'Contract+RED',
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    checkpoint,
    unit_goal_source: `${unit} @ BASE`,
    axes: Array.from({ length: 8 }, (_, i) => ({ axis: `a${i}`, verdict: 'pass', findings: [] })),
    coverage: [],
    reviewed_sha: (shaPrefix + 'd'.repeat(40)).slice(0, 40),
    ...extra,
  });
const VERDICT_JSON = verdictJson('docs/backlog/playground/x.md');
const ARTIFACT = 'docs/backlog/playground/reference/x-contract-red.json';
const LANDING = 'docs/backlog/playground/reference/x-final-green.json';
const LANDING_JSON = verdictJson('docs/backlog/playground/x.md', 'abc', 'Final+GREEN');
const ordinaryJson = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    checkpoint: 'ordinary',
    verdict: 'pass — no FIX left',
    reception: [],
    reviewed_sha: `abc${'d'.repeat(37)}`,
    ...extra,
  });

const read =
  (base: string | null, head: string | null, extra: Record<string, string | null> = {}) =>
  (path: string, side: 'base' | 'head') =>
    path in extra ? (side === 'head' ? extra[path] : null) : side === 'base' ? base : head;
const withArtifact = { [ARTIFACT]: VERDICT_JSON };

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

  it('a dropped user-traced row needs fork: in the re-cut line; a reworded one only the re-cut line (RDY-5)', () => {
    const base = traced('1. exact bytes → I1\n   wrapped continuation\n2. opener works → scenario');
    expect(userTracedRowCount(base)).toBe(2);
    const dropped = evaluate(
      [src, contract],
      read(base, traced('2. opener works → scenario', recut)),
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain('dropped beside source without a recorded fork');
    expect(
      evaluate([src, contract], read(base, traced('2. opener works → scenario', fork))),
    ).toHaveLength(0);
    expect(
      evaluate(
        [src, contract],
        read(base, traced('1. roughly equal bytes → I1\n2. opener works → scenario', recut)),
      ),
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

  it('refuses a ready flip beside production source on review: ordinary alone (RDY-8)', () => {
    expect(
      evaluate([src, contract], read(item('draft'), `${item('ready')}review: ordinary\n`)),
    ).toHaveLength(1);
    expect(
      evaluate(
        [src, contract],
        read(
          item('draft'),
          `${item('ready')}- ready-verdict: 2026-09-06 — Contract+RED @ abc\n`,
          withArtifact,
        ),
      ),
    ).toHaveLength(0);
    // Not beside production source: the referee is silent, the flip is the reviewer's (REV-10 axis 3).
    const toolsOnly = { status: 'M', path: 'tools/checks/x.mjs' };
    expect(
      evaluate([toolsOnly, contract], read(item('draft'), `${item('ready')}review: ordinary\n`)),
    ).toHaveLength(0);
  });

  it('treats the parity oracle harness and CI wiring as referees (PR-4)', () => {
    for (const path of [
      'tools/node-parity-runner/src/diff.ts',
      '.github/workflows/ci.yml',
      'tools/checks/ci-change-scope.mjs',
      'tools/backlog/check.mjs',
      'docs/process/rules/review.md',
      '.agents/skills/rifty-review/SKILL.md',
    ]) {
      const referee = { status: 'M', path };
      expect(evaluate([src, referee], read(null, null), [src, referee])).toHaveLength(1);
      expect(evaluate([referee], read(null, null), [referee])).toHaveLength(0);
    }
  });

  it('flags an in-place ready→in-progress edit as a rewrite', () => {
    expect(evaluate([src, contract], read(item('ready'), item('in-progress')))).toHaveLength(1);
  });

  it('allows head equal to merge-base modulo journal lines; a verdict line added beside code binds', () => {
    expect(evaluate([src, contract], read(item('ready'), item('ready')))).toHaveLength(0);
    expect(evaluate([src, contract], read(item('ready'), item('ready') + verdict))).toHaveLength(1);
    expect(
      evaluate([src, contract], read(item('ready'), item('ready') + verdict, withArtifact)),
    ).toHaveLength(0);
    expect(evaluate([src, contract], read(item('ready') + verdict, item('ready')))).toHaveLength(0);
  });

  it('requires a recorded verdict for a ready flip beside source', () => {
    const flipped = evaluate([src, contract], read(item('draft'), item('ready')));
    expect(flipped).toHaveLength(1);
    expect(flipped[0]).toContain(
      'ready flip beside production source without a pickup Contract+RED verdict',
    );
    expect(
      evaluate([src, contract], read(item('draft'), item('ready') + verdict, withArtifact)),
    ).toHaveLength(0);
    const added = { ...contract, status: 'A' };
    expect(evaluate([src, added], read(null, item('in-progress')))).toHaveLength(1);
    expect(evaluate([src, added], read(null, item('ready') + verdict, withArtifact))).toHaveLength(
      0,
    );
  });

  it('a ready-verdict: line binds to its committed verdict.json (REV-8)', () => {
    expect(verdictArtifactPath('docs/backlog/playground/x.md')).toBe(ARTIFACT);
    expect(verdictArtifactPath('net/y')).toBe('docs/backlog/net/reference/y-contract-red.json');
    const absent = evaluate([src, contract], read(item('draft'), item('ready') + verdict));
    expect(absent).toHaveLength(1);
    expect(absent[0]).toContain('absent or not JSON');
    expect(
      evaluate(
        [src, contract],
        read(item('draft'), item('ready') + verdict, {
          [ARTIFACT]: JSON.stringify({ checkpoint: 'Final+GREEN' }),
        }),
      ),
    ).toHaveLength(1);
    expect(
      evaluate(
        [src, contract],
        read(item('draft'), `${item('ready')}ready-verdict: yes\n`, withArtifact),
      ),
    ).toHaveLength(1);
    const inherited = `${item('ready')}ready-verdict: 2026-09-06 — inherited from net/y @ deadbeef\n`;
    expect(evaluate([src, contract], read(item('draft'), inherited))).toHaveLength(1);
    expect(
      evaluate(
        [src, contract],
        read(item('draft'), inherited, {
          'docs/backlog/net/reference/y-contract-red.json': verdictJson(
            'docs/backlog/net/y.md',
            'deadbeef',
          ),
        }),
      ),
    ).toHaveLength(0);
  });

  it('an older fork: line never licenses a later drop (RDY-5)', () => {
    const base = traced('1. exact bytes → I1\n2. opener works → scenario', fork);
    const later = traced(
      '2. opener works → scenario',
      `${fork}re-cut: 2026-09-06 — trimmed row 1 — trace: none\n`,
    );
    expect(evaluate([src, contract], read(base, later))).toHaveLength(1);
  });

  it('passes draft edits, docs-only diffs, demotions, and deletes', () => {
    expect(evaluate([src, contract], read(item('draft'), `${item('draft')} edited`))).toHaveLength(
      0,
    );
    expect(evaluate([contract], read(item('ready'), `${item('ready')} rewritten`))).toHaveLength(0);
    expect(evaluate([src, contract], read(item('ready'), item('draft')))).toHaveLength(0);
    // Delete on done beside production leaves the landing verdict behind (REV-8).
    const deleted = { ...contract, status: 'D' };
    expect(evaluate([src, deleted], read(item('ready'), null))).toHaveLength(1);
    expect(
      evaluate([src, deleted], read(item('ready'), null, { [LANDING]: LANDING_JSON })),
    ).toHaveLength(0);
    const ordinaryBase = `${item('ready')}review: ordinary\n`;
    const ordinaryLanding = 'docs/backlog/playground/reference/x-ordinary.json';
    expect(evaluate([src, deleted], read(ordinaryBase, null))).toHaveLength(1);
    expect(
      evaluate(
        [src, deleted],
        read(ordinaryBase, null, {
          [ordinaryLanding]: ordinaryJson(),
        }),
      ),
    ).toHaveLength(0);
    // A ready flip is checked in any diff: off production it needs review: ordinary or the verdict.
    const toolsOnly = { status: 'M', path: 'tools/checks/x.mjs' };
    expect(evaluate([toolsOnly, contract], read(item('draft'), item('ready')))).toHaveLength(1);
  });

  it('an ADR-traced row leaves only with the ADR named in the re-cut line (RDY-5)', () => {
    const base = traced('1. exact bytes → I1\n2. torn write throws → ADR-0358');
    const silent = traced('1. exact bytes → I1', recut);
    expect(evaluate([src, contract], read(base, silent))).toHaveLength(1);
    const named = traced(
      '1. exact bytes → I1',
      're-cut: 2026-09-06 — ADR-0358 row moved to the substrate unit — trace: none\n',
    );
    expect(evaluate([src, contract], read(base, named))).toHaveLength(0);
  });

  it('a compiled draft flipped, built and deleted inside one PR leaves both verdicts (REV-8, the merge head)', () => {
    const compiled = traced('1. exact bytes → I1'); // status: ready in the helper — use a draft variant
    const draftCompiled = compiled.replace('status: ready', 'status: draft');
    const deleted = { ...contract, status: 'D' };
    // A base draft with traced rows (compiled, built and deleted in-PR): the pair is required.
    expect(evaluate([src, deleted], read(draftCompiled, null))).toHaveLength(2);
    expect(
      evaluate([src, deleted], read(draftCompiled, null, { [ARTIFACT]: VERDICT_JSON })),
    ).toHaveLength(1);
    expect(
      evaluate(
        [src, deleted],
        read(draftCompiled, null, { [ARTIFACT]: VERDICT_JSON, [LANDING]: LANDING_JSON }),
      ),
    ).toHaveLength(0);
    // A plain draft (a finding, no traced rows) needs any landing verdict added in the diff.
    const plain = item('draft');
    expect(evaluate([src, deleted], read(plain, null))).toHaveLength(1);
    const landing = { status: 'A', path: 'docs/backlog/net/reference/pr-12-ordinary.json' };
    expect(evaluate([src, deleted, landing], read(plain, null))).toHaveLength(0);
  });

  it('a ready-verdict: line added or changed on an already-ready unit binds like a flip (REV-8)', () => {
    const added = traced('1. exact bytes → I1'); // the helper carries the verdict line
    const base = added.replace(verdict, '');
    expect(evaluate([src, contract], read(base, added))).toHaveLength(1);
    expect(evaluate([src, contract], read(base, added, withArtifact))).toHaveLength(0);
    const repointed = added.replace(verdict, 'ready-verdict: 2026-09-06 — Contract+RED @ fff\n');
    expect(evaluate([src, contract], read(added, repointed, withArtifact))).toHaveLength(1);
  });

  it('a dropped ADR row names THAT ADR, not any (RDY-5)', () => {
    const base = traced('1. exact bytes → I1\n2. torn write throws → ADR-0358');
    const other = traced(
      '1. exact bytes → I1',
      're-cut: 2026-09-06 — ADR-9999 row moved — trace: none\n',
    );
    expect(evaluate([src, contract], read(base, other))).toHaveLength(1);
  });

  it('parity cases ride with the product; lane configs and referees never — even beside tests only (PR-4)', () => {
    const testOnly = { status: 'M', path: 'packages/x/src/a.test.ts' };
    for (const path of ['tools/node-parity-runner/cases/fs/x.case.ts', 'examples/x/main.ts']) {
      expect(evaluate([src], read(null, null), [src, { status: 'M', path }])).toHaveLength(0);
    }
    for (const path of [
      'apps/playground/vitest.config.ts',
      'packages/vfs/package.json',
      'tools/node-parity-runner/src/cli.ts',
      'tools/checks/ci-change-scope.mjs',
    ]) {
      expect(evaluate([src], read(null, null), [src, { status: 'M', path }])).toHaveLength(1);
      expect(
        evaluate([testOnly], read(null, null), [testOnly, { status: 'M', path }]),
      ).toHaveLength(1);
    }
    // A referee PR carries its own tests: tools/checks/*.test.ts is not product code.
    const refereeTest = { status: 'M', path: 'tools/checks/contract-drift.test.ts' };
    const referee = { status: 'M', path: 'tools/checks/contract-drift.mjs' };
    expect(evaluate([refereeTest, referee], read(null, null))).toHaveLength(0);
  });

  it('beside production everything outside the product, its tests and its docs is a referee (PR-4)', () => {
    for (const path of [
      'AGENTS.md',
      'vitest.workspace.ts',
      'biome.json',
      'package.json',
      'docs/process/rules/stops.md',
    ]) {
      expect(evaluate([src], read(null, null), [src, { status: 'M', path }])).toHaveLength(1);
    }
    for (const path of [
      'examples/x/main.ts',
      'docs/adr/net/0001-x.md',
      'packages/x/CHANGELOG.md',
      'tsconfig.base.json',
      'pnpm-lock.yaml',
    ]) {
      expect(evaluate([src], read(null, null), [src, { status: 'M', path }])).toHaveLength(0);
    }
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
      expect(evaluate([src], read(null, null), [src, referee])[0]).toContain(
        'edits what judges it',
      );
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
      expect(blind.stderr).toContain(
        'ready flip beside production source without a pickup Contract+RED verdict',
      );
      // Recording the verdict — the line plus its committed verdict.json — makes the diff pass.
      mkdirSync(join(root, 'docs/backlog/net/reference'), { recursive: true });
      writeFileSync(
        join(root, 'docs/backlog/net/reference/x-contract-red.json'),
        verdictJson('docs/backlog/net/x.md'),
      );
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
