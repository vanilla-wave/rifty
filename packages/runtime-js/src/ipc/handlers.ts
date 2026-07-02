/**
 * Runtime-js sync RPC handler(s) (ADR-0011 phase 3, ADR-0039, ADR-0137).
 *
 * Owns the Node-API knowledge that used to live in
 * `@riftydev/kernel/ipc/default-handlers.ts`: parsing `node <script>` command
 * lines and recursively running the child. The handler PASSES THE SCRIPT PATH to
 * the runner (no longer the bytes — ADR-0137): the runner reads the source
 * through the module loader so a `#!` shebang is stripped and relative
 * `import`/`require` resolve against the VFS, like `child_process.spawn('node',
 * …)`. The handler keeps the `node <script>` validation + an ENOENT pre-check
 * (the resolver returning `null`); the entry-KIND decision (browser `kind:'url'`
 * node-entry child vs Node in-process loader-run) belongs to the runner, its
 * browser-vs-Node injection seam.
 *
 * Registration is explicit (`child_process` calls
 * {@link installRuntimeJsExecSyncHandler} at module load) because per ADR-0039
 * the kernel is now runtime-agnostic and ships no handlers by default; before
 * it auto-registered `'execSync'` from `getKernelDispatcher()`.
 */

import type { SyncRpcDispatcher } from '@riftydev/kernel';
import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import { type NodeEntryRunner, makeRecursiveRunner } from './recursive-runner.ts';

/** Argument shape the runtime-js `execSync` shim writes into the request. */
export interface ExecSyncPayload {
  /**
   * Command line, exactly as passed. Only `node <script-path>` is supported;
   * anything else is rejected so the caller falls through to the in-realm
   * path with the original error.
   */
  readonly cmd: string;
  /** `execSync` options; only `cwd` + `env` are forwarded. */
  readonly opts?: {
    readonly cwd?: string;
    readonly env?: Record<string, string>;
  };
}

/**
 * Caller-supplied existence probe: path in the store to its bytes (`null` when
 * absent). The handler uses it ONLY to surface a proper `ENOENT` before
 * spawning — the runner re-reads the source through the module loader, so the
 * bytes returned here are not what runs (the resolver may return any non-`null`
 * sentinel; production wraps `syncMirror()` so the probe matches the store the
 * child reads).
 */
export type ScriptResolver = (path: string) => Uint8Array | null;

/** Optional inputs to {@link installRuntimeJsExecSyncHandler}. */
export interface InstallRuntimeJsExecSyncOptions {
  /**
   * Override the runner (test / Node-conformance substitution). The handler
   * passes the resolved script PATH (`entryPath`) plus argv/env/cwd; the runner
   * owns the entry-kind decision (browser `kind:'url'` node-entry child vs Node
   * in-process loader-run). Defaults to {@link makeRecursiveRunner} (browser).
   */
  readonly runWorker?: NodeEntryRunner;
}

/**
 * Register the runtime-js `'execSync'` handler on `dispatcher`. Idempotent:
 * re-registering replaces the previous handler (per
 * {@link SyncRpcDispatcher.register}). The handler parses the command line,
 * ENOENT-checks the script via `resolveScript`, then hands the runner the script
 * PATH (not the bytes — ADR-0137: the runner reads it through the module loader
 * so a shebang/relative-import entry runs like `child_process.spawn('node', …)`),
 * and resolves with the child's stdout as raw `Uint8Array` bytes (ADR-0084 #23 —
 * carried byte-exact on a binary frame, so non-UTF-8 stdout is not mangled).
 */
export function installRuntimeJsExecSyncHandler(
  dispatcher: SyncRpcDispatcher,
  resolveScript: ScriptResolver,
  options: InstallRuntimeJsExecSyncOptions = {},
): void {
  const runWorker = options.runWorker ?? makeRecursiveRunner();

  dispatcher.register('execSync', async (rawPayload) => {
    const payload = coerceExecSyncPayload(rawPayload);
    const tokens = payload.cmd.split(/\s+/).filter(Boolean);
    if (tokens[0] !== 'node' || tokens.length < 2) {
      throw Object.assign(new Error(`execSync only supports 'node <script>': got ${payload.cmd}`), {
        code: 'EUNSUPPORTED',
      });
    }
    const cwd = payload.opts?.cwd ?? '/workspace';
    // Absolutize the entry against cwd, mirroring the `node <file>` shell command
    // (`resolveNodeEntry`, ADR-0155): the module loader treats a bare `build.js`
    // as a PACKAGE specifier (Node-faithful), so `execSync('node build.js')` must
    // resolve it to `<cwd>/build.js` before the runner — exactly Node's `argv[1]`.
    const rawArg = tokens[1] ?? '';
    const scriptPath = normalizePath(isAbsolute(rawArg) ? rawArg : joinPath(cwd, rawArg));
    // ENOENT pre-check ONLY: a missing script surfaces a proper ENOENT here
    // rather than as an opaque child loader miss. The bytes are discarded — the
    // runner re-reads the source through the module loader (ADR-0137: shebang
    // strip + relative `import`/`require` resolution), so `execSync('node x.js')`
    // runs x.js exactly like `spawn('node', ['x.js'])`.
    if (resolveScript(scriptPath) === null) {
      throw Object.assign(new Error(`execSync: script not found: ${scriptPath}`), {
        code: 'ENOENT',
      });
    }
    const result = await runWorker({
      entryPath: scriptPath,
      argv: ['rifty', scriptPath, ...tokens.slice(2)],
      env: payload.opts?.env ?? {},
      cwd,
    });
    if (result.exitCode !== 0) {
      // Surface the child's stderr in the failure message (Node's `execSync`
      // attaches the child stderr to the thrown error on failure). The recursive
      // runner captured it; decode for the message tail (kept short).
      const stderrText =
        result.stderr && result.stderr.byteLength > 0
          ? `\n${new TextDecoder().decode(result.stderr).trimEnd()}`
          : '';
      throw Object.assign(
        new Error(`Command failed with exit code ${result.exitCode}: ${payload.cmd}${stderrText}`),
        { code: 'ECHILDFAILED', exitCode: result.exitCode },
      );
    }
    // ADR-0084 #23: return the child's stdout BYTES verbatim. The dispatcher
    // emits a binary frame (Uint8Array value) so non-UTF-8 stdout reaches the
    // caller byte-exact — the old `new TextDecoder().decode(...)` mangled any
    // non-UTF-8 byte to U+FFFD before framing (a real Node-parity bug).
    return result.stdout;
  });
}

function coerceExecSyncPayload(v: unknown): ExecSyncPayload {
  if (typeof v !== 'object' || v === null) {
    throw new TypeError(`execSync: payload must be an object, got ${typeof v}`);
  }
  const p = v as { cmd?: unknown; opts?: unknown };
  if (typeof p.cmd !== 'string') {
    throw new TypeError('execSync: payload.cmd must be a string');
  }
  let opts: ExecSyncPayload['opts'] | undefined;
  if (p.opts !== undefined && p.opts !== null) {
    if (typeof p.opts !== 'object') {
      throw new TypeError('execSync: payload.opts must be an object');
    }
    const o = p.opts as { cwd?: unknown; env?: unknown };
    opts = {
      cwd: typeof o.cwd === 'string' ? o.cwd : undefined,
      env: isStringRecord(o.env) ? o.env : undefined,
    };
  }
  return { cmd: p.cmd, opts };
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null) return false;
  for (const value of Object.values(v as Record<string, unknown>)) {
    if (typeof value !== 'string') return false;
  }
  return true;
}
