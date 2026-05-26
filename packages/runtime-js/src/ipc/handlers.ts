/**
 * Runtime-js sync RPC handler(s) (ADR-0011 phase 3, ADR-0039).
 *
 * Owns the Node-API knowledge that used to live in
 * `@rifty/kernel/ipc/default-handlers.ts`: parsing `node <script>` command
 * lines, resolving the script's bytes from the VFS sync mirror, and
 * recursively spawning a kernel Worker to run the child.
 *
 * The registration is explicit — runtime-js's `child_process` module calls
 * {@link installRuntimeJsExecSyncHandler} once at module load. Before
 * ADR-0039 the kernel auto-registered an `'execSync'` handler from its
 * `getKernelDispatcher()` factory; the kernel is now runtime-agnostic and
 * ships no handlers by default.
 */

import type { SyncRpcDispatcher, WorkerEntryDescriptor } from '@rifty/kernel';
import { type RecursiveRunResult, makeRecursiveRunner } from './recursive-runner.ts';

/**
 * Argument shape the runtime-js `execSync` shim writes into the request.
 */
export interface ExecSyncPayload {
  /**
   * Command line as a single string, exactly as passed by the user. We
   * only support `node <script-path>` — anything else is rejected so the
   * caller can fall through to the in-realm path with the original error.
   */
  readonly cmd: string;
  /** `execSync` options. Currently we only forward `cwd` + `env`. */
  readonly opts?: {
    readonly cwd?: string;
    readonly env?: Record<string, string>;
  };
}

/**
 * Caller-supplied script loader: given a path in the child's VFS, returns
 * the bytes (or `null` when absent). Runtime-js wires this with a thin
 * wrapper around `syncMirror()` so the SAB path reads the same source
 * of truth as the in-realm fallback.
 */
export type ScriptResolver = (path: string) => Uint8Array | null;

/** Optional inputs to {@link installRuntimeJsExecSyncHandler}. */
export interface InstallRuntimeJsExecSyncOptions {
  /** Override the recursive runner (test substitution). */
  readonly runWorker?: (spec: {
    readonly entry: WorkerEntryDescriptor;
    readonly argv: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    readonly cwd: string;
  }) => Promise<RecursiveRunResult>;
}

/**
 * Register the runtime-js `'execSync'` handler on `dispatcher`. Idempotent
 * — re-registering replaces the previous handler (per
 * {@link SyncRpcDispatcher.register} semantics). The handler parses the
 * caller's command line, resolves the script's bytes via `resolveScript`,
 * spawns a recursive kernel Worker that runs the child, and resolves with
 * the captured stdout as a UTF-8 string.
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
    const scriptPath = tokens[1] ?? '';
    const sourceBytes = resolveScript(scriptPath);
    if (sourceBytes === null) {
      throw Object.assign(new Error(`execSync: script not found: ${scriptPath}`), {
        code: 'ENOENT',
      });
    }
    const source = new TextDecoder().decode(sourceBytes);
    const result = await runWorker({
      entry: { kind: 'source', code: source, sourceUrl: scriptPath },
      argv: ['rifty', scriptPath, ...tokens.slice(2)],
      env: payload.opts?.env ?? {},
      cwd: payload.opts?.cwd ?? '/workspace',
    });
    if (result.exitCode !== 0) {
      throw Object.assign(
        new Error(`Command failed with exit code ${result.exitCode}: ${payload.cmd}`),
        { code: 'ECHILDFAILED', exitCode: result.exitCode },
      );
    }
    return new TextDecoder().decode(result.stdout);
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
