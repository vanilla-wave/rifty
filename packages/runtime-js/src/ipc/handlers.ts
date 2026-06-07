/**
 * Runtime-js sync RPC handler(s) (ADR-0011 phase 3, ADR-0039).
 *
 * Owns the Node-API knowledge that used to live in
 * `@riftydev/kernel/ipc/default-handlers.ts`: parsing `node <script>` command
 * lines, resolving the script's bytes from the VFS sync mirror, and
 * recursively spawning a kernel Worker to run the child.
 *
 * Registration is explicit (`child_process` calls
 * {@link installRuntimeJsExecSyncHandler} at module load) because per ADR-0039
 * the kernel is now runtime-agnostic and ships no handlers by default; before
 * it auto-registered `'execSync'` from `getKernelDispatcher()`.
 */

import type { SyncRpcDispatcher, WorkerEntryDescriptor } from '@riftydev/kernel';
import { type RecursiveRunResult, makeRecursiveRunner } from './recursive-runner.ts';

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
 * Caller-supplied script loader: path in the child's VFS to bytes (`null` when
 * absent). Runtime-js wraps `syncMirror()` so the SAB path reads the same
 * source of truth as the in-realm fallback.
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
 * Register the runtime-js `'execSync'` handler on `dispatcher`. Idempotent:
 * re-registering replaces the previous handler (per
 * {@link SyncRpcDispatcher.register}). The handler parses the command line,
 * resolves script bytes via `resolveScript`, spawns a recursive kernel Worker,
 * and resolves with the child's stdout as raw `Uint8Array` bytes (ADR-0084 #23
 * — carried byte-exact on a binary frame, so non-UTF-8 stdout is not mangled).
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
