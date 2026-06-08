import { expect, it } from 'vitest';
import { packColumns } from '../src/commands/_columns.ts';

it('packs GNU ls down-then-across: 2 cols win at width 10', () => {
  // N=5 names. Candidate col counts (most-first): 5/4/3 all overflow 10 once
  // each column is padded to its widest entry + 2-space gutters; 2 cols fit
  // (col widths 3 and 4 -> 3+2+4 = 9 <= 10). Fill DOWN: col0=[a,bb,ccc],
  // col1=[dddd,e]. Trailing column is NOT padded (no trailing whitespace).
  // Verified byte-for-byte against GNU coreutils `gls -C -w 10`.
  const out = packColumns(['a', 'bb', 'ccc', 'dddd', 'e'], 10);
  expect(out).toBe('a    dddd\nbb   e\nccc\n');
});

it('a single name >= width -> one name per line (one column)', () => {
  // 'verylongname123' (15) >= 10 forces single column; trailing newline.
  expect(packColumns(['verylongname123'], 10)).toBe('verylongname123\n');
});

it('multiple over-width names each fall on their own line', () => {
  // No multi-column layout can fit, so c=1: one name per line.
  expect(packColumns(['verylongname123', 'anotherlongname456'], 10)).toBe(
    'verylongname123\nanotherlongname456\n',
  );
});

it('empty input -> empty string (no trailing newline)', () => {
  expect(packColumns([], 80)).toBe('');
});
