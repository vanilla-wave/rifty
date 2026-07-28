import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  declaredBudgetSelection,
  declaredSlice,
  declaredSlices,
  evaluateMass,
  globToRegExp,
  newPath,
  parseBudget,
  scanMechanisms,
  validateBudgetAuthority,
  validateRunDeclarations,
  validateSelectedSliceItems,
} from './budget.mjs';

const epic = `---
kind: epic
status: ready
---

## Budget

- new coordination mechanisms: 0
- generated globs: \`docs/public/compat/**\`, \`packages/*/src/generated/**\`
- slices (hand-written insertions):

| slice | band |
|---|---|
| oracle-slice | 300–1000 |
| registry-core | 2000-4000 |

## Items
`;

describe('parseBudget', () => {
  it('reads slices with en-dash and hyphen bands, globs, mechanisms pin', () => {
    const budget = parseBudget(epic);
    expect(budget?.slices.get('oracle-slice')).toEqual({ lo: 300, hi: 1000 });
    expect(budget?.slices.get('registry-core')).toEqual({ lo: 2000, hi: 4000 });
    expect(budget?.generated).toHaveLength(2);
    expect(budget?.mechanismsZero).toBe(true);
    expect(budget?.substrate).toBeNull();
  });

  it('reads a substrate escape and returns null without a Budget section', () => {
    const withSubstrate = epic.replace(
      'mechanisms: 0',
      'mechanisms: 0, or substrate: npm-client/shadow-registry-core',
    );
    expect(parseBudget(withSubstrate)?.substrate).toBe('npm-client/shadow-registry-core');
    expect(parseBudget('## Items\n')).toBeNull();
  });
});

describe('validateBudgetAuthority', () => {
  const addRow = (text: string, row: string) =>
    text.replace('| registry-core | 2000-4000 |', `| registry-core | 2000-4000 |\n${row}`);

  it('accepts an identical existing slice and one selected JIT row/item', () => {
    expect(validateBudgetAuthority(epic, epic, 'oracle-slice')).toEqual([]);
    const pickup = addRow(epic, '| jit | 10–20 |').replace(
      '## Items',
      '## Items\n\n- `playground/jit` — **jit**: ready.',
    );
    expect(validateBudgetAuthority(epic, pickup, 'jit')).toEqual([]);
  });

  it.each([
    ['rewritten row', epic.replace('300–1000', '300–2000')],
    ['deleted row', epic.replace('| oracle-slice | 300–1000 |\n', '')],
    [
      'reordered rows',
      epic.replace(
        '| oracle-slice | 300–1000 |\n| registry-core | 2000-4000 |',
        '| registry-core | 2000-4000 |\n| oracle-slice | 300–1000 |',
      ),
    ],
    ['rewritten tripwire', epic.replace('mechanisms: 0', 'mechanisms: 1')],
    ['rewritten glob', epic.replace('docs/public/compat/**', 'docs/public/**')],
  ])('rejects %s', (_case, pickup) => {
    expect(validateBudgetAuthority(epic, pickup, 'oracle-slice')).toEqual([
      'pickup rewrites merge-base Budget content or existing rows',
    ]);
  });

  it('rejects extra, wrong, and duplicate rows', () => {
    const extra = addRow(epic, '| jit | 10–20 |\n| extra | 1–2 |');
    expect(validateBudgetAuthority(epic, extra, 'jit')).toEqual(
      expect.arrayContaining([
        'pickup adds 2 Budget rows; want at most one',
        'pickup adds Budget row "extra" instead of selected slice "jit"',
      ]),
    );

    const wrong = addRow(epic, '| other | 10–20 |');
    expect(validateBudgetAuthority(epic, wrong, 'jit')).toEqual([
      'pickup adds Budget row "other" instead of selected slice "jit"',
    ]);

    const duplicate = addRow(epic, '| jit | 10–20 |\n| jit | 10–20 |');
    expect(validateBudgetAuthority(epic, duplicate, 'jit')).toEqual(
      expect.arrayContaining([
        'pickup duplicates Budget row "jit"',
        'pickup adds 2 Budget rows; want at most one',
      ]),
    );
  });
});

describe('newPath / globToRegExp', () => {
  it('resolves rename numstat paths to the new side', () => {
    expect(newPath('apps/playground/src/{glue => workers}/a.ts')).toBe(
      'apps/playground/src/workers/a.ts',
    );
    expect(newPath('a.ts => b.ts')).toBe('b.ts');
    expect(newPath('plain/path.ts')).toBe('plain/path.ts');
  });

  it('matches ** across segments and * within one', () => {
    const regexp = globToRegExp('packages/*/src/generated/**');
    expect(regexp.test('packages/npm-client/src/generated/deep/file.ts')).toBe(true);
    expect(regexp.test('packages/a/b/src/generated/file.ts')).toBe(false);
  });
});

describe('evaluateMass', () => {
  const band = { lo: 300, hi: 1000 };
  const generated = [globToRegExp('docs/public/compat/**')];
  const testSupportPaths = [
    'packages/x/src/a.test.ts',
    'packages/x/src/a.spec.tsx',
    'packages/x/src/a.test-fixture.js',
    'packages/x/src/a.contract-fixtures.jsx',
    'apps/x/test/a.mjs',
    'apps/x/tests/a.cjs',
    'services/x/__tests__/a.ts',
    'services/x/fixtures/a.tsx',
    'packages/npm-client/src/_test-fixtures/tar-builder.ts',
    'packages/workbench/src/workers/test-fixtures/durable-owner-fs.ts',
    'apps/playground/src/glue/test-monaco-editor.ts',
    'packages/runtime-wasi/src/syscalls/fd-test-fixture.ts',
    'tools/checks/run-pickup.test.ts',
    'tests/e2e/vite-save-trust-rebind.spec.ts',
    'packages/x/src/a.test.d.ts',
    'packages/x/src/a.spec.d.ts',
    'packages/x/src/a.test-fixture.d.ts',
    'packages/x/src/a.contract-fixtures.d.ts',
    'tools/checks/a.test.ts.snap',
    'docs/process/a.test.coverage.md',
  ];

  it('is ok within band; generated and binary rows excluded', () => {
    const result = evaluateMass(
      [
        { added: 900, path: 'packages/x/src/a.ts' },
        { added: 5000, path: 'packages/x/src/a.test.ts' },
        { added: 5000, path: 'apps/x/tests/a.ts' },
        { added: 5000, path: 'services/x/fixtures/a.ts' },
        { added: 5000, path: 'docs/public/compat/esbuild.md' },
        { added: null, path: 'apps/playground/logo.png' },
      ],
      band,
      generated,
    );
    expect(result).toMatchObject({ insertions: 900, level: 'ok' });
  });

  it('warns over band and fails at 2× band', () => {
    expect(evaluateMass([{ added: 1500, path: 'a.ts' }], band, []).level).toBe('warn');
    expect(evaluateMass([{ added: 2000, path: 'a.ts' }], band, []).level).toBe('fail');
  });

  it.each(testSupportPaths)('excludes test support %s', (path) => {
    expect(evaluateMass([{ added: 5000, path }], band, [])).toMatchObject({
      insertions: 0,
      level: 'ok',
    });
  });

  it.each([
    'docs/process/testing.md',
    'tools/checks/run-pickup.mjs',
    'tools/test-utils/helper.ts',
    'tests-manual/e2e/save.ts',
    'docs/backlog/process-meta/test-coverage-debt.md',
    'docs/process/a-test-fixture.md',
  ])('counts ordinary hand-written other path %s', (path) => {
    expect(evaluateMass([{ added: 5000, path }], band, [])).toMatchObject({
      insertions: 5000,
      level: 'fail',
    });
  });
});

describe('scanMechanisms', () => {
  it('finds identifiers only in added production source', () => {
    const hits = scanMechanisms([
      { path: 'packages/x/src/fifo-owner.ts', content: 'const epoch = 1;' },
      { path: 'docs/adr/npm-client/0309-x.md', content: 'epoch epoch epoch' },
      { path: 'packages/x/src/owner.test.ts', content: 'const generation = 1;' },
      { path: 'packages/x/src/owner.test-fixture.ts', content: 'const epoch = 1;' },
      { path: 'packages/x/src/owner.contract-fixtures.ts', content: 'const opId = 1;' },
      { path: 'packages/x/src/comment.ts', content: '/** Existing FIFO owner. */\nexport {};' },
      { path: 'packages/x/src/clean.ts', content: 'export const a = 1;' },
    ]);
    expect(hits).toEqual(['packages/x/src/fifo-owner.ts (epoch)']);
  });

  it.each([
    'packages/x/src/a.test.ts',
    'packages/x/tests/a.ts',
    'packages/npm-client/src/_test-fixtures/tar-builder.ts',
    'packages/workbench/src/workers/test-fixtures/durable-owner-fs.ts',
    'apps/playground/src/glue/test-monaco-editor.ts',
    'packages/runtime-wasi/src/syscalls/fd-test-fixture.ts',
  ])('ignores mechanism names in test support %s', (path) => {
    expect(scanMechanisms([{ path, content: 'export const epoch = 1;' }])).toEqual([]);
  });
});

describe('Budget declaration routing', () => {
  it('prefers env, falls back to every PR-body declaration', () => {
    expect(declaredSlice({ RIFTY_BUDGET_SLICE: ' e/s ' }, () => '')).toBe('e/s');
    const event = JSON.stringify({
      pull_request: {
        body: [
          'Budget-Slice: honest-shadow-substitutions/registry-core',
          'Budget-Slice: honest-shadow-substitutions/package-tree-authority',
        ].join('\n'),
      },
    });
    expect(declaredSlices({ GITHUB_EVENT_PATH: '/tmp/ev.json' }, () => event)).toEqual([
      'honest-shadow-substitutions/registry-core',
      'honest-shadow-substitutions/package-tree-authority',
    ]);
    expect(declaredSlice({ GITHUB_EVENT_PATH: '/tmp/ev.json' }, () => event)).toBeNull();
    expect(declaredSlice({}, () => '')).toBeNull();
    expect(declaredSlice({ GITHUB_EVENT_PATH: '/x' }, () => 'not json')).toBeNull();
  });

  it('recognises legacy plural forms so they fail closed', () => {
    const event = JSON.stringify({
      pull_request: {
        body: ['Budget-Slices: goal/a, goal/b', 'Budget-Reason: old grouped-run exception'].join(
          '\n',
        ),
      },
    });
    expect(declaredBudgetSelection({ GITHUB_EVENT_PATH: '/tmp/ev.json' }, () => event)).toEqual({
      slices: ['goal/a', 'goal/b'],
      plural: true,
    });
    expect(declaredBudgetSelection({ RIFTY_BUDGET_SLICES: 'goal/a' }, () => '')).toEqual({
      slices: ['goal/a'],
      plural: true,
    });
    expect(validateRunDeclarations(['goal/a'], [], true).error).toContain('unsupported');
  });
});

describe('validateSelectedSliceItems', () => {
  const ready = (linkedEpic: string) => `---
area: playground
status: ready
title: Work
epic: ${linkedEpic}
---
`;
  const epicText = `${epic}
1. \`playground/a\` — **oracle-slice**: numbered.
- \`playground/b\` — **registry-core**: bullet.
`;
  const read = (path: string): string | null => {
    if (path === 'docs/backlog/playground/a.md') return ready('goal');
    if (path === 'docs/backlog/playground/b.md') return ready('other');
    return null;
  };

  it('accepts numbered or bullet mapping to one ready reverse-linked item', () => {
    expect(validateSelectedSliceItems(epicText, ['oracle-slice'], 'goal', read)).toEqual([]);
    expect(validateSelectedSliceItems(epicText, ['registry-core'], 'goal', read)[0]).toContain(
      'not reverse-linked',
    );
  });

  it('rejects missing and duplicate mappings', () => {
    expect(validateSelectedSliceItems(epicText, ['missing'], 'goal', read)[0]).toContain(
      'no Items mapping',
    );
    const duplicate = `${epicText}- \`playground/c\` — **oracle-slice**: duplicate.\n`;
    expect(validateSelectedSliceItems(duplicate, ['oracle-slice'], 'goal', read)[0]).toContain(
      '2 Items mappings',
    );
  });
});

describe('validateRunDeclarations', () => {
  const goalSha = '0123456789abcdef0123456789abcdef01234567';

  it('allows normal non-goal PRs and requires paired single declarations', () => {
    expect(validateRunDeclarations([], [])).toEqual({ mode: 'normal' });
    expect(validateRunDeclarations(['honest-shadow-substitutions/oracle-slice'], [])).toMatchObject(
      { error: expect.stringContaining('Goal-Baseline') },
    );
    expect(validateRunDeclarations([], [`honest-shadow-substitutions@${goalSha}`])).toMatchObject({
      error: expect.stringContaining('Budget-Slice'),
    });
    expect(
      validateRunDeclarations(
        ['honest-shadow-substitutions/a', 'honest-shadow-substitutions/b'],
        [`honest-shadow-substitutions@${goalSha}`],
      ),
    ).toMatchObject({ error: expect.stringContaining('exactly one') });
  });

  it('requires the slice and goal to name the same epic', () => {
    expect(
      validateRunDeclarations(['other/oracle-slice'], [`honest-shadow-substitutions@${goalSha}`]),
    ).toMatchObject({ error: expect.stringContaining('does not match') });
    expect(
      validateRunDeclarations(
        ['honest-shadow-substitutions/oracle-slice'],
        [`honest-shadow-substitutions@${goalSha}`],
      ),
    ).toMatchObject({
      mode: 'goal',
      epicSlug: 'honest-shadow-substitutions',
      slice: 'oracle-slice',
    });
  });

  it('takes JIT row and ready-item authority before source and retains it after closure', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-budget-pickup-'));
    try {
      mkdirSync(join(root, 'docs/backlog/epics'), { recursive: true });
      mkdirSync(join(root, 'docs/backlog/playground'), { recursive: true });
      mkdirSync(join(root, 'packages/x/src'), { recursive: true });
      const epicPath = join(root, 'docs/backlog/epics/goal.md');
      const initialEpic = `---
kind: epic
status: ready
title: Goal
created: 2026-07-25
value: Goal
---

## Outcome

Goal.

## User scenario

Run it.

## Items

Known work.

## Budget

| slice | band |
|---|---|
| seed | 1–10 |
`;
      writeFileSync(epicPath, initialEpic);
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'base'],
        { cwd: root },
      );
      const baseline = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', baseline], { cwd: root });

      const itemPath = join(root, 'docs/backlog/playground/jit.md');
      writeFileSync(
        itemPath,
        `---
area: playground
status: ready
title: JIT
created: 2026-07-25
why: Required by goal
epic: goal
---
`,
      );
      writeFileSync(
        epicPath,
        initialEpic
          .replace('Known work.', '- `playground/jit` — **jit**: just-in-time unit.')
          .replace('| seed | 1–10 |', '| seed | 1–10 |\n| jit | 1–10 |'),
      );
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Rifty',
          '-c',
          'user.email=rifty@example.test',
          'commit',
          '-m',
          'contract red',
        ],
        { cwd: root },
      );
      writeFileSync(join(root, 'packages/x/src/a.ts'), 'export const shipped = true;\n');
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'source'],
        { cwd: root },
      );
      rmSync(itemPath);
      writeFileSync(
        epicPath,
        initialEpic.replace('Known work.', '- `playground/jit` — **jit**: historical unit.'),
      );

      const script = fileURLToPath(new URL('./budget.mjs', import.meta.url));
      const output = execFileSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_PATH: undefined,
          RIFTY_GOAL_BASELINE: `goal@${baseline}`,
          RIFTY_BUDGET_SLICE: 'goal/jit',
        },
      });
      expect(output).toContain('budget: OK');
      expect(output).toContain('goal/jit');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
