import { expect, it } from 'vitest';
import { pathFromTerminalFileLink } from './terminal-links.ts';

it('accepts normalized file links inside the workspace', () => {
  expect(pathFromTerminalFileLink('file:///workspace/src/main.js')).toBe('/workspace/src/main.js');
  expect(pathFromTerminalFileLink('file:///workspace/src/../README.md')).toBe(
    '/workspace/README.md',
  );
});

it('rejects non-file, outside-workspace, and traversal-to-parent links', () => {
  expect(pathFromTerminalFileLink('https://example.test/workspace/src/main.js')).toBeNull();
  expect(pathFromTerminalFileLink('file:///etc/passwd')).toBeNull();
  expect(pathFromTerminalFileLink('file:///workspace/../secret.txt')).toBeNull();
});
