import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  combinedBand,
  declaredRun,
  declaredSlice,
  evaluateMass,
  globToRegExp,
  newPath,
  parseBudget,
  scanMechanisms,
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
    const b = parseBudget(epic);
    expect(b?.slices.get('oracle-slice')).toEqual({ lo: 300, hi: 1000 });
    expect(b?.slices.get('registry-core')).toEqual({ lo: 2000, hi: 4000 });
    expect(b?.generated).toHaveLength(2);
    expect(b?.mechanismsZero).toBe(true);
    expect(b?.substrate).toBeNull();
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

describe('newPath / globToRegExp', () => {
  it('resolves rename numstat paths to the new side', () => {
    expect(newPath('apps/playground/src/{glue => workers}/a.ts')).toBe(
      'apps/playground/src/workers/a.ts',
    );
    expect(newPath('a.ts => b.ts')).toBe('b.ts');
    expect(newPath('plain/path.ts')).toBe('plain/path.ts');
  });

  it('matches ** across segments and * within one', () => {
    const re = globToRegExp('packages/*/src/generated/**');
    expect(re.test('packages/npm-client/src/generated/deep/file.ts')).toBe(true);
    expect(re.test('packages/a/b/src/generated/file.ts')).toBe(false);
  });
});

describe('evaluateMass', () => {
  const band = { lo: 300, hi: 1000 };
  const generated = [globToRegExp('docs/public/compat/**')];

  it('ok within band; generated and binary rows excluded', () => {
    const r = evaluateMass(
      [
        { added: 900, path: 'packages/x/src/a.ts' },
        { added: 5000, path: 'docs/public/compat/esbuild.md' },
        { added: null, path: 'apps/playground/logo.png' },
      ],
      band,
      generated,
    );
    expect(r).toMatchObject({ insertions: 900, level: 'ok' });
  });

  it('warns over band, fails over 2× band', () => {
    expect(evaluateMass([{ added: 1500, path: 'a.ts' }], band, []).level).toBe('warn');
    expect(evaluateMass([{ added: 2001, path: 'a.ts' }], band, []).level).toBe('fail');
  });
});

describe('scanMechanisms', () => {
  it('flags identifiers only in added production source', () => {
    const hits = scanMechanisms([
      { path: 'packages/x/src/fifo-owner.ts', content: 'const epoch = 1;' },
      { path: 'docs/adr/npm-client/0309-x.md', content: 'epoch epoch epoch' },
      { path: 'packages/x/src/owner.test.ts', content: 'const generation = 1;' },
      { path: 'packages/x/src/comment.ts', content: '/** Existing FIFO owner. */\nexport {};' },
      { path: 'packages/x/src/clean.ts', content: 'export const a = 1;' },
    ]);
    expect(hits).toEqual(['packages/x/src/fifo-owner.ts (epoch)']);
  });
});

describe('declaredSlice', () => {
  it('prefers env, falls back to PR body, null when absent', () => {
    expect(declaredSlice({ RIFTY_BUDGET_SLICE: ' e/s ' }, () => '')).toBe('e/s');
    const event = JSON.stringify({
      pull_request: { body: 'Some PR.\nBudget-Slice: honest-shadow-substitutions/oracle-slice\n' },
    });
    expect(declaredSlice({ GITHUB_EVENT_PATH: '/tmp/ev.json' }, () => event)).toBe(
      'honest-shadow-substitutions/oracle-slice',
    );
    expect(declaredSlice({}, () => '')).toBeNull();
    expect(declaredSlice({ GITHUB_EVENT_PATH: '/x' }, () => 'not json')).toBeNull();
  });
});

describe('combined requester-approved run', () => {
  const selected = [
    'honest-shadow-substitutions/registry-core',
    'honest-shadow-substitutions/package-tree-authority',
    'honest-shadow-substitutions/esbuild-vite-cutover',
  ];

  it('reads multiple slices and reason from the PR body', () => {
    const event = JSON.stringify({
      pull_request: {
        body: [
          `Budget-Slices: ${selected.join(', ')}`,
          'Budget-Reason: requester required every PR #170 slice in one implementation PR',
        ].join('\n'),
      },
    });
    expect(declaredRun({ GITHUB_EVENT_PATH: '/tmp/event.json' }, () => event)).toEqual({
      slices: selected,
      reason: 'requester required every PR #170 slice in one implementation PR',
    });
  });

  it('sums original slice bands instead of inventing a wider contract', () => {
    expect(
      combinedBand(
        new Map([
          ['registry-core', { lo: 2000, hi: 4000 }],
          ['package-tree-authority', { lo: 2000, hi: 4000 }],
          ['esbuild-vite-cutover', { lo: 2000, hi: 4000 }],
        ]),
        ['registry-core', 'package-tree-authority', 'esbuild-vite-cutover'],
      ),
    ).toEqual({ lo: 6000, hi: 12000 });
  });

  it('requires every selected slice to map exactly once to a ready item', () => {
    const epicText = `${epic}
1. \`npm-client/shadow-registry-core\` — **registry-core**: core.
2. \`npm-client/shadow-registry-core-copy\` — **registry-core**: duplicate.
3. \`playground/oracle\` — **oracle-slice**: oracle.
4. \`playground/missing\` — **missing-slice**: missing.
`;
    const read = (path: string): string | null =>
      path === 'docs/backlog/playground/oracle.md' ? '---\nstatus: draft\n---\n' : null;
    expect(validateSelectedSliceItems(epicText, ['registry-core', 'oracle-slice'], read)).toEqual([
      'Budget slice "registry-core" has 2 Items mappings',
      'docs/backlog/playground/oracle.md is not ready',
    ]);
    expect(validateSelectedSliceItems(epicText, ['unmapped'], read)).toEqual([
      'Budget slice "unmapped" has no Items mapping',
    ]);
    expect(validateSelectedSliceItems(epicText, ['missing-slice'], read)).toEqual([
      'docs/backlog/playground/missing.md does not exist',
    ]);
  });

  it('validates all selected contracts at pickup after delete-on-done closure in HEAD', () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-budget-pickup-'));
    try {
      mkdirSync(join(root, 'docs/backlog/epics'), { recursive: true });
      mkdirSync(join(root, 'docs/backlog/npm-client'), { recursive: true });
      mkdirSync(join(root, 'docs/backlog/playground'), { recursive: true });
      mkdirSync(join(root, 'packages/x/src'), { recursive: true });
      writeFileSync(
        join(root, 'docs/backlog/epics/honest-shadow-substitutions.md'),
        `${epic.replace(
          '| registry-core | 2000-4000 |\n',
          [
            '| registry-core | 2000-4000 |',
            '| package-tree-authority | 2000-4000 |',
            '| esbuild-vite-cutover | 2000-4000 |',
            '',
          ].join('\n'),
        )}
1. \`npm-client/shadow-registry-core\` — **registry-core**: core.
2. \`npm-client/package-tree-authority\` — **package-tree-authority**: owner.
3. \`playground/esbuild-vite-cutover\` — **esbuild-vite-cutover**: cutover.
`,
      );
      for (const item of [
        'npm-client/shadow-registry-core',
        'npm-client/package-tree-authority',
        'playground/esbuild-vite-cutover',
      ]) {
        writeFileSync(
          join(root, `docs/backlog/${item}.md`),
          `---
area: ${item.split('/')[0]}
status: ready
title: X
epic: honest-shadow-substitutions
---
`,
        );
      }
      execFileSync('git', ['init', '-b', 'main'], { cwd: root });
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        ['-c', 'user.name=Rifty', '-c', 'user.email=rifty@example.test', 'commit', '-m', 'base'],
        { cwd: root },
      );
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root });

      for (const item of [
        'npm-client/shadow-registry-core',
        'npm-client/package-tree-authority',
        'playground/esbuild-vite-cutover',
      ]) {
        rmSync(join(root, `docs/backlog/${item}.md`));
      }
      const epicPath = join(root, 'docs/backlog/epics/honest-shadow-substitutions.md');
      const closedEpic = readFileSync(epicPath, 'utf8')
        .replace(/^\| (?:registry-core|package-tree-authority|esbuild-vite-cutover) \|.*\n/gmu, '')
        .replace(
          /^\d+\. `(?:npm-client\/shadow-registry-core|npm-client\/package-tree-authority|playground\/esbuild-vite-cutover)`.*\n/gmu,
          '',
        );
      writeFileSync(epicPath, closedEpic);
      writeFileSync(join(root, 'packages/x/src/a.ts'), 'export const shipped = true;\n');

      const script = fileURLToPath(new URL('./budget.mjs', import.meta.url));
      const output = execFileSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          RIFTY_BUDGET_SLICES: selected.join(','),
          RIFTY_BUDGET_REASON: 'one requested implementation PR',
        },
      });
      expect(output).toContain('budget: OK');
      expect(output).toContain('within band 6000–12000');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
