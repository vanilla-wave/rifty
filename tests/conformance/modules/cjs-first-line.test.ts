import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => resetSyncMirror());

// Node reads a CJS file as is: its start keeps its meaning behind rifty's
// shared-line wrapper (ADR-0450 2026-11-22 N3; Node v24.16.0).
describe('CJS file start as Node reads it', () => {
  it('a leading `-->` loads; a BOM stays, so a BOM before `#!` fails and nothing runs', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/app/bom.js': '﻿exports.ok = true;\n',
      '/app/bom-bang.js': '﻿#!/usr/bin/env node\nglobalThis.__riftyBomRan = true;\n',
      '/app/close.js': '--> legacy\nexports.ok = true;\n',
    });
    setSyncMirror(vfs);
    const loader = createModuleLoader(vfs);
    expect(loader.require('./bom.js', '/app/main.js')).toEqual({ ok: true });
    expect(loader.require('./close.js', '/app/main.js')).toEqual({ ok: true });
    expect(() => loader.require('./bom-bang.js', '/app/main.js')).toThrow(/\/app\/bom-bang\.js/u);
    expect(Reflect.get(globalThis, '__riftyBomRan')).toBeUndefined();
  });
});
