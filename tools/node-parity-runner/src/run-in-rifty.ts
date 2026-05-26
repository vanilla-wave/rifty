/**
 * Run case code through the rifty module loader and capture stdout.
 *
 * Scope: the loader is the rifty path under test. We deliberately do NOT
 * monkey-patch global `process` or `Promise.prototype.then` here — that would
 * leak into the runner itself. Behaviours that depend on rifty's promise/
 * nextTick patches are covered by the conformance suite, which can install
 * the patches in a controlled `beforeAll`/`afterAll` scope. The parity runner
 * focuses on module-shape semantics: `node:path`, `node:buffer`, `node:util`,
 * `node:querystring`, `node:events`, `node:url`, etc.
 *
 * Console is replaced for the duration of the case, then restored.
 */
import { setProcessCwd } from '@rifty/runtime-js/builtins/process';
import { createModuleLoader } from '@rifty/runtime-js/loader';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@rifty/vfs/internal';
import { formatArgs } from '../../../packages/runtime-js/src/repl/inspect.ts';
import type { ParityCase } from './types.ts';

export async function runInRifty(testCase: ParityCase): Promise<string> {
  const vfs = new MemoryFsSync();
  const files: Record<string, string> = {};
  if (testCase.setup?.files) {
    for (const [rel, content] of Object.entries(testCase.setup.files)) {
      files[`/work/${rel}`] = content;
    }
  }
  const ext = testCase.kind === 'esm' ? 'mjs' : 'js';
  files[`/work/main.${ext}`] = testCase.code;
  vfs.loadFixture(files);

  // Replace the global sync mirror so `fs.readFileSync` / `fs.writeFileSync`
  // in user code see the case's files instead of bleeding from other cases.
  // Setup files are exposed at '/' so cases can use either bare names (with
  // resolvePath using cwd='/') or absolute paths.
  const fsFiles: Record<string, string> = {};
  if (testCase.setup?.files) {
    for (const [rel, content] of Object.entries(testCase.setup.files)) {
      fsFiles[`/${rel}`] = content;
    }
  }
  const fsMirror = new MemoryFsSync();
  fsMirror.loadFixture(fsFiles);
  setSyncMirror(fsMirror);

  // Mirror Node's view: process.cwd() = '/'. Important so `fs.readFileSync('a.txt')`
  // resolves against the same anchor as the Node child running with cwd=tmpdir.
  // Use the runtime's per-Worker cwd cell rather than monkey-patching the
  // `process` object (ADR-0019).
  setProcessCwd('/');

  const loader = createModuleLoader(vfs, { cwd: '/work' });

  const captured: string[] = [];
  const writeStdout = (...args: unknown[]) => {
    captured.push(`${formatArgs(args)}\n`);
  };
  const writeStderr = (...args: unknown[]) => {
    captured.push(`${formatArgs(args)}\n`);
  };
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };
  console.log = writeStdout;
  console.info = writeStdout;
  console.debug = writeStdout;
  console.warn = writeStderr;
  console.error = writeStderr;
  try {
    if (testCase.kind === 'esm') {
      await loader.import('./main.mjs', '/work/__entry.mjs');
    } else {
      loader.require('./main.js', '/work/__entry.js');
    }
    // Drain microtasks + short setTimeout used in async cases. 25ms covers
    // any 1ms setTimeout in cases; a real bug here wouldn't be hidden by
    // waiting longer.
    await new Promise((r) => setTimeout(r, 25));
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
    console.warn = original.warn;
    console.error = original.error;
    resetSyncMirror();
    setProcessCwd('/workspace');
  }
  return captured.join('');
}
