import { expect, it } from 'vitest';
import { porcelainXY } from '../src/index.ts';

it('maps statusMatrix codes to porcelain XY', () => {
  expect(porcelainXY('111')).toBeNull();
  expect(porcelainXY('020')).toBe('??');
  expect(porcelainXY('022')).toBe('A ');
  expect(porcelainXY('003')).toBe('AD');
  expect(porcelainXY('121')).toBe(' M');
  expect(porcelainXY('122')).toBe('M ');
  expect(porcelainXY('123')).toBe('MM');
  expect(porcelainXY('101')).toBe(' D');
  expect(porcelainXY('100')).toBe('D ');
  expect(porcelainXY('999')).toBe('999');
});
