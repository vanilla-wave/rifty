import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BASELINE, RECORD_DELTA, THRESHOLD, evaluate, measureFiles } from './file-size.mjs';

const B = [{ file: 'pkg/src/big.ts', max: 1000 }];

describe('evaluate', () => {
  it('refuses a NEW file over the threshold', () => {
    const v = evaluate([{ file: 'pkg/src/fresh.ts', lines: THRESHOLD + 1 }], [], THRESHOLD);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('pkg/src/fresh.ts');
  });

  it('passes a new file at exactly the threshold', () => {
    expect(evaluate([{ file: 'pkg/src/fresh.ts', lines: THRESHOLD }], [], THRESHOLD)).toEqual([]);
  });

  it('refuses growth of a grandfathered file', () => {
    const v = evaluate([{ file: 'pkg/src/big.ts', lines: 1001 }], B, THRESHOLD);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('grew 1000 → 1001');
  });

  it('allows ordinary churn under the record slack', () => {
    expect(
      evaluate([{ file: 'pkg/src/big.ts', lines: 1000 - RECORD_DELTA + 1 }], B, THRESHOLD),
    ).toEqual([]);
  });

  it('forces a real burn-down to be recorded', () => {
    const v = evaluate([{ file: 'pkg/src/big.ts', lines: 1000 - RECORD_DELTA }], B, THRESHOLD);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain(`lower its BASELINE entry to ${1000 - RECORD_DELTA}`);
  });

  it('forces entry deletion once the file is back under the threshold', () => {
    const v = evaluate([{ file: 'pkg/src/big.ts', lines: THRESHOLD }], B, THRESHOLD);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('delete its BASELINE entry');
  });

  it('refuses a stale entry for a deleted file', () => {
    const v = evaluate([], B, THRESHOLD);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('no longer exists');
  });
});

describe('measureFiles', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('counts prod sources only — no tests, .d.ts, or generated/vendor dirs', () => {
    root = mkdtempSync(join(tmpdir(), 'file-size-'));
    const src = join(root, 'pkg', 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'a.ts'), 'x\ny\nz');
    writeFileSync(join(src, 'b.mjs'), 'x');
    writeFileSync(join(src, 'a.test.ts'), 'x');
    writeFileSync(join(src, 'a.fault.test.ts'), 'x');
    writeFileSync(join(src, 'types.d.ts'), 'x');
    mkdirSync(join(src, 'generated'));
    writeFileSync(join(src, 'generated', 'big.js'), 'x');
    mkdirSync(join(src, 'tests'));
    writeFileSync(join(src, 'tests', 'helper.ts'), 'x');

    const files = measureFiles(root, 'pkg')
      .map((m) => m.file)
      .sort();
    expect(files).toEqual(['pkg/src/a.ts', 'pkg/src/b.mjs']);
    expect(measureFiles(root, 'pkg').find((m) => m.file === 'pkg/src/a.ts')?.lines).toBe(3);
  });
});

describe('BASELINE', () => {
  it('is sorted by size, unique, and every entry is over the threshold', () => {
    const files = BASELINE.map((e) => e.file);
    expect(new Set(files).size).toBe(files.length);
    for (const e of BASELINE) expect(e.max).toBeGreaterThan(THRESHOLD);
    const sizes = BASELINE.map((e) => e.max);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });
});
