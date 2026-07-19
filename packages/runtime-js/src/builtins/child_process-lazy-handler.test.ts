/**
 * #26 PART B (perf) — the runtime-js `'execSync'` SAB handler is installed on
 * the FIRST require of `child_process`, not eagerly at module/startup load.
 *
 * Guard for the cold-start saving: requiring only the hot-core builtins must
 * not install the `execSync` handler (it pulls the kernel dispatcher + sync
 * mirror). Requiring `child_process` installs it, and the live handler still
 * services dispatch — proving install-on-first-require precedes any reachable
 * `execSync()` call (execSync is reachable ONLY via this module's exports).
 * Behavior-preserving: see `ipc/handlers.test.ts` for the handler's wire
 * contract and the `binary-stdout-exec` parity case for byte-exactness.
 *
 * Test isolation: `loadBuiltin` caches factory results process-wide, so each
 * case re-registers the `child_process` factory (busting the cache) against a
 * freshly-cleared kernel dispatcher, then observes which methods install.
 */

import { loadBuiltin, registerBuiltin } from '@riftydev/io';
import { type SyncRpcHandler, clearKernelDispatcher, getKernelDispatcher } from '@riftydev/kernel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installRuntimeJsExecSyncHandler } from '../ipc/handlers.ts';

// Importing the barrel registers every builtin factory as a side effect.
import './index.ts';
import childProcessModule, { ensureExecSyncHandlerInstalled } from './child_process.ts';

/** Hot-core builtins that stay eager-static (the #26 gate); none install the
 * execSync handler. */
const HOT_CORE = ['path', 'util', 'events', 'buffer', 'process', 'stream', 'fs', 'os', 'crypto'];

/**
 * Wrap the current singleton dispatcher's `register` so the test observes which
 * methods get installed without coupling to its private handler map (the same
 * approach as `ipc/handlers.test.ts`). Returns the recorded method set and a
 * getter for the live `execSync` handler.
 */
function watchDispatcher(): {
  installed: Set<string>;
  execSyncHandler: () => SyncRpcHandler | null;
} {
  const dispatcher = getKernelDispatcher();
  const installed = new Set<string>();
  let execSyncHandler: SyncRpcHandler | null = null;
  const original = dispatcher.register.bind(dispatcher);
  dispatcher.register = ((method: string, handler: SyncRpcHandler) => {
    installed.add(method);
    if (method === 'execSync') execSyncHandler = handler;
    original(method, handler);
  }) as typeof dispatcher.register;
  return { installed, execSyncHandler: () => execSyncHandler };
}

describe('#26 PART B — execSync handler installs on first child_process require', () => {
  beforeEach(() => {
    // Fresh dispatcher + un-cached factory so the lazy install is observable
    // regardless of test order (other suites may have required child_process).
    clearKernelDispatcher();
    registerBuiltin('child_process', () => {
      ensureExecSyncHandlerInstalled();
      return childProcessModule;
    });
  });
  afterEach(() => {
    clearKernelDispatcher();
  });

  it('does NOT install the execSync handler when only hot-core builtins are required', () => {
    const { installed } = watchDispatcher();
    for (const name of HOT_CORE) {
      expect(loadBuiltin(name)).not.toBeNull();
    }
    expect(installed.has('execSync')).toBe(false);
  });

  it('installs the execSync handler on the first child_process require, and the live handler services dispatch', async () => {
    const { installed, execSyncHandler } = watchDispatcher();

    // Before requiring child_process the handler is absent on the fresh dispatcher.
    expect(installed.has('execSync')).toBe(false);

    const cp = loadBuiltin('child_process');
    expect(cp).not.toBeNull();
    expect(typeof (cp as Record<string, unknown>).execSync).toBe('function');

    // First require installed the execSync handler.
    expect(installed.has('execSync')).toBe(true);
    const handler = execSyncHandler();
    expect(handler).not.toBeNull();

    // The live handler is the runtime-js code path: a non-`node <script>` command
    // is rejected with EUNSUPPORTED (proves it is wired end-to-end, not a no-op).
    await expect(
      (handler as SyncRpcHandler)({
        cmd: 'ls -la',
        opts: { cwd: '/workspace', env: {} },
      }),
    ).rejects.toMatchObject({
      code: 'EUNSUPPORTED',
    });
  });

  it('does not replace an explicit host-owned handler on first child_process require', () => {
    const dispatcher = getKernelDispatcher();
    installRuntimeJsExecSyncHandler(dispatcher, () => new Uint8Array(), {
      runWorker: async () => ({ stdout: new Uint8Array(), exitCode: 0 }),
    });
    const afterExplicitInstall = watchDispatcher();

    expect(loadBuiltin('child_process')).not.toBeNull();
    expect(afterExplicitInstall.installed.has('execSync')).toBe(false);
  });

  it('does not re-run the factory on a second cached require', () => {
    expect(loadBuiltin('child_process')).not.toBeNull();

    // loadBuiltin caches the factory result, so a second require runs neither the
    // factory nor the install — observe that no further register fires.
    const after = watchDispatcher();
    expect(loadBuiltin('child_process')).not.toBeNull();
    expect(after.installed.has('execSync')).toBe(false);
  });
});
