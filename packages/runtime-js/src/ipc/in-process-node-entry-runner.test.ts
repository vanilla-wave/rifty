/**
 * In-process node-entry runner (ADR-0137) — the Node-conformance execSync
 * substitute. Proves the runner loader-runs the entry IN-PROCESS honoring the
 * SAME module-loader behaviors as the browser `kind:'url'` path: shebang strip,
 * relative `import`/`require` resolution, sibling `fs.readFileSync` — with no
 * kernel Worker / `kind:'url'` bootstrap (the gap the old raw `kind:'source'`
 * `new AsyncFunction` path had: it chokes on `#!`, can't resolve relatives).
 *
 * `makeInProcessNodeEntryRunner` is what the parity `exec-sync` mode + a
 * Node-hosted execSync test use instead of {@link makeRecursiveRunner} (which
 * spawns a Worker). These tests are the in-process proof the item's parity cases
 * describe; the browser-only `kind:'url'` remote-fs path is proven by the e2e.
 */

import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { setProcessCwd } from '../builtins/process.ts';
import { makeInProcessNodeEntryRunner } from './in-process-node-entry-runner.ts';

const dec = new TextDecoder();

afterEach(() => {
  resetSyncMirror();
  setProcessCwd('/workspace');
});

/** Seed an in-memory mirror with the given files and make it the global mirror. */
function seedMirror(files: Record<string, string>): void {
  const mirror = new MemoryFsSync();
  mirror.loadFixture(files);
  setSyncMirror(mirror);
}

describe('makeInProcessNodeEntryRunner — Node loader-run path (ADR-0137)', () => {
  it('strips a `#!` shebang (no SyntaxError, line not echoed)', async () => {
    seedMirror({
      '/scripts/build.js': "#!/usr/bin/env node\nprocess.stdout.write('ok');\n",
    });
    const run = makeInProcessNodeEntryRunner();
    const result = await run({
      entryPath: '/scripts/build.js',
      argv: ['rifty', '/scripts/build.js'],
      env: {},
      cwd: '/scripts',
    });
    expect(result.exitCode).toBe(0);
    // The shebang is neither executed nor echoed — exactly `ok`, not a throw and
    // not the `#!` line. The raw `new AsyncFunction` path would SyntaxError here.
    expect(dec.decode(result.stdout)).toBe('ok');
  });

  it('resolves a relative CJS `require()` against the store', async () => {
    seedMirror({
      '/scripts/build.js': "const u = require('./util.js'); process.stdout.write(u.greet());\n",
      '/scripts/util.js': "module.exports = { greet: () => 'hi-from-util' };\n",
    });
    const run = makeInProcessNodeEntryRunner();
    const result = await run({
      entryPath: '/scripts/build.js',
      argv: ['rifty', '/scripts/build.js'],
      env: {},
      cwd: '/scripts',
    });
    expect(result.exitCode).toBe(0);
    expect(dec.decode(result.stdout)).toBe('hi-from-util');
  });

  it('resolves a relative ESM `import` against the store', async () => {
    seedMirror({
      '/app/package.json': JSON.stringify({ type: 'module' }),
      '/app/main.js': "import { v } from './config.js'; process.stdout.write(v);\n",
      '/app/config.js': "export const v = 'cfg-value';\n",
    });
    const run = makeInProcessNodeEntryRunner();
    const result = await run({
      entryPath: '/app/main.js',
      argv: ['rifty', '/app/main.js'],
      env: {},
      cwd: '/app',
    });
    expect(result.exitCode).toBe(0);
    expect(dec.decode(result.stdout)).toBe('cfg-value');
  });

  it('reads a sibling file via `fs.readFileSync` (the owner store, not an empty mirror)', async () => {
    seedMirror({
      '/proj/run.js':
        "const fs = require('node:fs'); process.stdout.write(fs.readFileSync('/proj/pkg.json', 'utf8'));\n",
      '/proj/pkg.json': '{"name":"demo"}',
    });
    const run = makeInProcessNodeEntryRunner();
    const result = await run({
      entryPath: '/proj/run.js',
      argv: ['rifty', '/proj/run.js'],
      env: {},
      cwd: '/proj',
    });
    expect(result.exitCode).toBe(0);
    expect(dec.decode(result.stdout)).toBe('{"name":"demo"}');
  });

  it('captures non-UTF-8 stdout byte-exact', async () => {
    seedMirror({
      '/bin.js': 'process.stdout.write(Buffer.from([0xff, 0xfe, 0x00]));\n',
    });
    const run = makeInProcessNodeEntryRunner();
    const result = await run({
      entryPath: '/bin.js',
      argv: ['rifty', '/bin.js'],
      env: {},
      cwd: '/',
    });
    expect(result.exitCode).toBe(0);
    expect(Array.from(result.stdout)).toEqual([0xff, 0xfe, 0x00]);
  });

  it('a thrown error → exitCode 1', async () => {
    seedMirror({ '/bad.js': "throw new Error('boom');\n" });
    const run = makeInProcessNodeEntryRunner();
    const result = await run({
      entryPath: '/bad.js',
      argv: ['rifty', '/bad.js'],
      env: {},
      cwd: '/',
    });
    expect(result.exitCode).toBe(1);
  });

  it('honors a non-zero `process.exitCode` set by the entry', async () => {
    seedMirror({
      '/code.js': "process.stdout.write('partial'); process.exitCode = 3;\n",
    });
    const run = makeInProcessNodeEntryRunner();
    const result = await run({
      entryPath: '/code.js',
      argv: ['rifty', '/code.js'],
      env: {},
      cwd: '/',
    });
    expect(result.exitCode).toBe(3);
    expect(dec.decode(result.stdout)).toBe('partial');
  });
});
