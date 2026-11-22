import { compileFunction } from 'node:vm';
import { fatalReportText } from '@riftydev/runtime-js/internal';
import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';

function setup(files: Record<string, string>) {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  setSyncMirror(vfs);
  return createModuleLoader(vfs);
}

afterEach(() => resetSyncMirror());

// Node: a CJS module that fails to compile throws V8's own SyntaxError (no
// `code`, message from `compileFunction`); the module is named by the fatal
// report's `<file>:<line>` header, not the message. Was rifty's
// `ModuleLoadError: Failed to compile CJS module …` wrapper.
describe('CJS compile error is Node SyntaxError', () => {
  it('throws V8 SyntaxError with compileFunction message and a header naming the file', () => {
    const source = 'this is not valid javascript at all';
    const loader = setup({ '/app/broken.js': source });
    let caught: unknown;
    try {
      loader.require('./broken.js', '/app/main.js');
    } catch (err) {
      caught = err;
    }
    let native: unknown;
    try {
      compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname']);
    } catch (err) {
      native = err;
    }
    expect(caught).toBeInstanceOf(SyntaxError);
    expect((caught as Error).message).toBe((native as Error).message);
    expect((caught as { code?: unknown }).code).toBeUndefined();
    expect(fatalReportText(caught)).toMatch(
      /^\/app\/broken\.js:1\nthis is not valid javascript at all\n/u,
    );
  });

  it('a valid CJS module still loads (no false positive)', () => {
    const loader = setup({ '/app/ok.js': "module.exports = 'fine';" });
    expect(loader.require('./ok.js', '/app/main.js')).toBe('fine');
  });
});
