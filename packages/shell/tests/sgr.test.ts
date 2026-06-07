import { expect, it } from 'vitest';
import { colorize, sgr } from '../src/commands/_sgr.ts';

const ESC = String.fromCharCode(27);

it('sgr wraps with the exact ESC[<code>m ... ESC[0m sequence', () => {
  // Exact bytes matter: a typo in the reset (e.g. ESC[m vs ESC[0m) leaks color downstream.
  expect(sgr('1;34', 'x')).toBe(`${ESC}[1;34mx${ESC}[0m`);
});

it('colorize is identity when disabled (--color=never / non-TTY path)', () => {
  // Load-bearing: `ls --color=auto > f` must write NO SGR into the file.
  expect(colorize('dir', { isDirectory: true, isFile: false }, false)).toBe('dir');
});

it('colorize wraps directories in bold blue (1;34) when enabled', () => {
  const out = colorize('dir', { isDirectory: true, isFile: false }, true);
  expect(out).toContain('1;34');
  expect(out).toBe(`${ESC}[1;34mdir${ESC}[0m`);
});

it('colorize leaves a regular file plain even when enabled', () => {
  // VFS has no exec-bit / symlink (ADR-0050) -> only directories are colored.
  expect(colorize('f.txt', { isDirectory: false, isFile: true }, true)).toBe('f.txt');
});
