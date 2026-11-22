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
// report's `<file>:<line>` header, not the message. rifty prints no header
// (ADR-0445 2026-11-22): its stack's second line names the file and rifty's
// parser position instead. Was rifty's `ModuleLoadError: Failed to compile CJS module …`.
describe('CJS compile error is Node SyntaxError', () => {
  it('throws V8 SyntaxError with compileFunction message, naming the file and parser position', () => {
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
      /^SyntaxError: Unexpected identifier 'is'\n {4}\(rifty parser position: \/app\/broken\.js:1:6\)\n/u,
    );
  });

  it('a file keeps its BOM as Node reads it: a BOM before `#!` fails and nothing runs', () => {
    const loader = setup({
      '/app/bom.js': '\uFEFFexports.ok = true;\n',
      '/app/bom-bang.js': '\uFEFF#!/usr/bin/env node\nglobalThis.__riftyBomRan = true;\n',
      '/app/close.js': '--> legacy\nexports.ok = true;\n',
    });
    expect(loader.require('./bom.js', '/app/main.js')).toEqual({ ok: true });
    expect(loader.require('./close.js', '/app/main.js')).toEqual({ ok: true });
    expect(() => loader.require('./bom-bang.js', '/app/main.js')).toThrow(SyntaxError);
    expect(Reflect.get(globalThis, '__riftyBomRan')).toBeUndefined();
  });

  it('a valid CJS module still loads (no false positive)', () => {
    const loader = setup({ '/app/ok.js': "module.exports = 'fine';" });
    expect(loader.require('./ok.js', '/app/main.js')).toBe('fine');
  });
});
