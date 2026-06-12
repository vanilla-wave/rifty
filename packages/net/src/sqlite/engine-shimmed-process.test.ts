import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: `defaultLocateFile` ran INSIDE the async WASM bring-up, so an
 * embedder that swapped `globalThis.process` for the rifty shim FIRST (the
 * worker bootstrap, integration harnesses calling `installProcessGlobals()`)
 * broke detection — the shim advertises `process.versions.node` but has no
 * `getBuiltinModule`, so init threw "cannot resolve node:module" deep inside
 * sql.js and the memoised engine promise never settled (callers hung forever).
 *
 * Contract pinned here: the Node `getBuiltinModule` binding is captured at
 * MODULE-EVAL time, so a later process swap cannot retroactively break the
 * default wasm lookup.
 *
 * Fresh module instance per test (`vi.resetModules` + dynamic import): the
 * engine memoises process-wide, and this suite must own an un-inited copy.
 */
describe('sqlite engine under a swapped process shim', () => {
  const savedProcess = globalThis.process;

  afterEach(() => {
    globalThis.process = savedProcess;
  });

  it('initSqliteEngine() still locates the wasm after process is replaced by a Node-shaped shim', async () => {
    vi.resetModules();
    const engine = await import('./engine.ts');

    // Node-shaped shim, mirroring rifty's `installProcessGlobals()` surface:
    // versions.node/argv/on present (compat), getBuiltinModule ABSENT.
    globalThis.process = {
      versions: { node: '20.0.0' },
      env: {},
      argv: ['node'],
      on: () => {},
      // vitest's own error handler probes these on uncaught failures; no-ops
      // keep a PRE-FIX failure diagnosable instead of crashing the worker.
      listeners: () => [],
      removeListener: () => {},
    } as unknown as NodeJS.Process;

    const sql = await engine.initSqliteEngine();
    expect(typeof sql.Database).toBe('function');
  });
});
