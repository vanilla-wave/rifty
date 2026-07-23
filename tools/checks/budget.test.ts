import { describe, expect, it } from 'vitest';
import {
  declaredSlice,
  evaluateMass,
  globToRegExp,
  newPath,
  parseBudget,
  scanMechanisms,
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
  it('flags mechanism-class markers only in added source files', () => {
    const hits = scanMechanisms([
      { path: 'packages/x/src/fifo-owner.ts', content: 'const epoch = 1;' },
      { path: 'docs/adr/npm-client/0309-x.md', content: 'epoch epoch epoch' },
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
