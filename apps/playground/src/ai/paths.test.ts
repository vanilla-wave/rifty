import { describe, expect, it } from 'vitest';
import { resolveWorkspacePath, workspaceRelative } from './paths.ts';

describe('resolveWorkspacePath', () => {
  it('resolves relative paths against the workspace root', () => {
    expect(resolveWorkspacePath('/scratch', 'src/main.js')).toBe('/scratch/src/main.js');
    expect(resolveWorkspacePath('/scratch', './a/./b')).toBe('/scratch/a/b');
    expect(resolveWorkspacePath('/scratch', '.')).toBe('/scratch');
  });

  it('accepts absolute paths inside the root', () => {
    expect(resolveWorkspacePath('/scratch', '/scratch/x.txt')).toBe('/scratch/x.txt');
  });

  it('throws on any escape from the workspace root', () => {
    expect(() => resolveWorkspacePath('/scratch', '../etc/passwd')).toThrow(/escapes/);
    expect(() => resolveWorkspacePath('/scratch', 'a/../../b')).toThrow(/escapes/);
    expect(() => resolveWorkspacePath('/scratch', '/projects/other')).toThrow(/escapes/);
    expect(() => resolveWorkspacePath('/scratch', '')).toThrow(/empty/);
  });
});

describe('workspaceRelative', () => {
  it('maps root to "." and strips the root prefix', () => {
    expect(workspaceRelative('/scratch', '/scratch')).toBe('.');
    expect(workspaceRelative('/scratch', '/scratch/src/a.js')).toBe('src/a.js');
  });
});
