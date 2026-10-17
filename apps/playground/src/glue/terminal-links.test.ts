import { expect, it } from 'vitest';
import { pathFromTerminalFileLink } from './terminal-links.ts';

it('maps normalized file links inside the workspace to project paths', () => {
  expect(pathFromTerminalFileLink('file:///workspace/src/main.js')).toBe('/src/main.js');
  expect(pathFromTerminalFileLink('file:///workspace/src/../README.md')).toBe('/README.md');
  expect(pathFromTerminalFileLink('file:///home/project/src/main.js', '/home/project')).toBe(
    '/src/main.js',
  );
  expect(pathFromTerminalFileLink('file:///home/rifty/.npmrc', '/home/project')).toBeNull();
});

it('accepts descendants when the workspace is the filesystem root', () => {
  expect(pathFromTerminalFileLink('file:///src/main.js', '/')).toBe('/src/main.js');
});

it('rejects non-file, outside-workspace, and traversal-to-parent links', () => {
  expect(pathFromTerminalFileLink('https://example.test/workspace/src/main.js')).toBeNull();
  expect(pathFromTerminalFileLink('file:///etc/passwd')).toBeNull();
  expect(pathFromTerminalFileLink('file:///workspace/../secret.txt')).toBeNull();
});
