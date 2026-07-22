import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluate, measureSrcDirs } from './dir-owner.mjs';

describe('evaluate', () => {
  it('flags an over-threshold dir without README, passes one with', () => {
    const measured = [
      { dir: 'a/src/big', count: 31, hasReadme: false },
      { dir: 'a/src/owned', count: 99, hasReadme: true },
      { dir: 'a/src/small', count: 30, hasReadme: false },
    ];
    const violations = evaluate(measured, 30);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('a/src/big');
  });
});

describe('measureSrcDirs', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('counts direct prod modules only — no tests, .d.ts, subdirs, or non-src dirs', () => {
    root = mkdtempSync(join(tmpdir(), 'dir-owner-'));
    const src = join(root, 'pkg', 'src', 'deep');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'a.ts'), '');
    writeFileSync(join(src, 'b.tsx'), '');
    writeFileSync(join(src, 'a.test.ts'), '');
    writeFileSync(join(src, 'a.spec.tsx'), '');
    writeFileSync(join(src, 'types.d.ts'), '');
    writeFileSync(join(src, 'README.md'), '');
    mkdirSync(join(src, 'nested'));
    writeFileSync(join(src, 'nested', 'c.ts'), '');
    writeFileSync(join(root, 'pkg', 'root.ts'), ''); // outside src — not measured
    mkdirSync(join(src, 'tests'));
    writeFileSync(join(src, 'tests', 'd.ts'), ''); // test-support dir — skipped

    const measured = measureSrcDirs(root, 'pkg');
    const byDir = new Map(measured.map((m) => [m.dir, m]));
    expect(byDir.get(join('pkg', 'src', 'deep'))).toEqual({
      dir: join('pkg', 'src', 'deep'),
      count: 2,
      hasReadme: true,
    });
    expect(byDir.get(join('pkg', 'src', 'deep', 'nested'))?.count).toBe(1);
    expect(byDir.has('pkg')).toBe(false);
    expect(byDir.has(join('pkg', 'src', 'deep', 'tests'))).toBe(false);
  });
});
