import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// node-entry-bootstrap.ts is a worker-only `kind:'url'` entry: top-level await
// + import-time side effects (reads the kernel process shim's argv, re-routes
// console, RUNS the entry) — importing it in node vitest executes a program
// run. What remains here are realm-wiring pins.
const source = readFileSync(
  fileURLToPath(new URL('./node-entry-bootstrap.ts', import.meta.url)),
  'utf8',
);

describe('node-entry bootstrap wiring (worker realm)', () => {
  it('runs serve:true children with bin:true when RIFTY_BIN=1', () => {
    // residual source pin: the serve-vs-run branch and the bin flag are read off
    // the kernel-installed `proc` at the entry's TOP LEVEL — observable only by
    // executing the entry in a kernel worker (browser-unit/e2e lane).
    expect(source).toContain('RIFTY_NODE_SERVE');
    expect(source).toContain('bin: proc.env.RIFTY_BIN ===');
  });

  it('prepares only real vite bin invocations; prep is mode-independent', () => {
    // residual source pin: the call happens in top-level await of the worker
    // entry. The recognizer is the bin name alone (the retired CAC grammar's
    // mode result was discarded — never null, gated nothing); prepareViteCli
    // just installs the keepalive pin + esbuild bridge.
    expect(source).toMatch(
      /proc\.env\.RIFTY_BIN === '1' && binNameOf\(entryPath\) === 'vite'[\s\S]*await prepareViteCli\(proc\.cwd\(\)\);/,
    );
    expect(source).not.toMatch(/viteCliMode/);
  });

  it('installs the esbuild host bridge for EVERY node child, not just vite', () => {
    // The shadow-registry shim overlays every installed `esbuild` package and
    // delegates to globalThis.__riftyEsbuild — a plain `node -e
    // "require('esbuild').transform(...)"` must reach the REAL host, not die
    // on "host bridge missing" because only vite runs installed it.
    expect(source).toMatch(/^installEsbuildBridge\(\);$/m);
  });

  it('consumes forwarded worker URLs and installs the nested-worker fs relay', () => {
    // buildChildSpawnSpec forwards RIFTY_KERNEL_WORKER_URL /
    // RIFTY_NODE_ENTRY_WORKER_URL, but forwarding alone is inert: the child
    // must CONSUME them (setKernelWorkerUrl/setNodeEntryWorkerUrl — else
    // worker_threads sees null and silently degrades to same-realm) and serve
    // nested workers' fs.* sync-RPC (installRuntimeJsFsHandlers relay), or
    // Rolldown's WASI pthread pool crashes on its first fs call.
    expect(source).toMatch(
      /installRuntimeJsFsHandlers\([\s\S]*setKernelWorkerUrl\([\s\S]*setNodeEntryWorkerUrl\(/,
    );
  });

  it('does not carry the retired editor-write invalidation bridge', () => {
    // Stock chokidar observes owner writes through the remote sync FS. The old
    // fork-IPC bridge hid watcher regressions by invalidating Vite directly.
    expect(source).not.toMatch(
      /rifty:vite-file-change|__riftyActiveViteServer|invalidateViteModule|RIFTY_VITE_CLI_/,
    );
  });
});
