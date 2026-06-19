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
  it('reports the INTENTIONAL simplified (non-Node-shape) diagnostic for a missing file', () => {
    // Pins rifty's DELIBERATE single-line form, NOT real-Node parity. Real Node
    // emits multi-line `Error: Cannot find module '<abs>' … { code:'MODULE_NOT_FOUND',
    // requireStack: [] }`; rifty's owner-store pre-check returns this terser shape
    // (compat process.md ⚠️). Real-Node shape via the loader is
    // backlog/runtime-js/node-entry-miss-node-shape — this asserts intent, not parity.
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
