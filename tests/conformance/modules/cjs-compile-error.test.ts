import { createModuleLoader, ModuleLoadError } from '@rifty/runtime-js/loader';
import { MemoryFsSync } from '@rifty/vfs/internal';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>) {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

// A CJS module that fails to parse used to throw a bare `SyntaxError` from
// `new Function` with no file context (only `at new Function (<anonymous>)` in
// the stack). The loader now wraps it in a directed ModuleLoadError naming the
// module — mirroring the ESM path — which is how the opencode graph-load gate
// pinned a prose `.txt` file being executed as CJS.
describe('CJS compile error carries module context', () => {
  it('a syntactically-invalid CJS module throws a ModuleLoadError naming the file', () => {
    const loader = setup({ '/app/broken.js': 'this is not valid javascript at all' });
    let caught: unknown;
    try {
      loader.require('./broken.js', '/app/main.js');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ModuleLoadError);
    expect((caught as ModuleLoadError).message).toContain('/app/broken.js');
    expect((caught as Error).message).toContain('Failed to compile CJS module');
  });

  it('a valid CJS module still loads (no false positive)', () => {
    const loader = setup({ '/app/ok.js': "module.exports = 'fine';" });
    expect(loader.require('./ok.js', '/app/main.js')).toBe('fine');
  });
});
