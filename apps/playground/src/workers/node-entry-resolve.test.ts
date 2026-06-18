import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { resolveNodeEntry } from './node-entry-resolve.ts';

describe('resolveNodeEntry', () => {
  it('resolves a relative path against cwd and confirms it exists', () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync('/w', { recursive: true });
    fs.writeFileSync('/w/app.js', new TextEncoder().encode('//'));
    expect(resolveNodeEntry(fs, '/w', 'app.js')).toEqual({ ok: true, path: '/w/app.js' });
  });
  it('reports a clean diagnostic for a missing file', () => {
    const fs = new MemoryFsSync();
    expect(resolveNodeEntry(fs, '/w', 'nope.js')).toEqual({
      ok: false,
      message: "node: cannot find module '/w/nope.js'\n",
    });
  });
  it('errors with usage when no file is given', () => {
    const fs = new MemoryFsSync();
    expect(resolveNodeEntry(fs, '/w', undefined)).toEqual({
      ok: false,
      message: 'node: missing entry file\nUsage: node <file> [args]\n',
    });
  });
});
