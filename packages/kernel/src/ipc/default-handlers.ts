/**
 * Default sync RPC handlers wired into every {@link SyncRpcDispatcher}
 * created by `spawnKernelWorker` (ADR-0011 phase 3).
 *
 * Currently registers:
 *   - `'execSync'` — recursive child spawn: parses `{cmd, opts}`, spins up
 *     a fresh kernel Worker for the requested `node <script>` invocation,
 *     captures its stdout into a buffer, and resolves with the buffer's
 *     UTF-8 string view once the child exits.
 *
 * The kernel can serve `execSync` from inside another Worker because
 * `spawnKernelWorker` only requires `globalThis.Worker` (DOM/Node 22+
 * exposes it everywhere a kernel could plausibly run). Recursion is
 * bounded only by the host's Worker quota and the user's script.
 */

import type { WorkerEntryDescriptor } from '../worker-entry.ts';
import type { SyncRpcDispatcher } from './sync-dispatch.ts';

/**
 * Subset of {@link SpawnWorkerSpec} the recursive `execSync` runner needs.
 * Declared locally to avoid a cycle between this module and
 * `spawn-worker.ts` (which imports {@link registerDefaultHandlers}); the
 * runner constructs the full spec on the spawn-worker side, this type just
 * documents what the handler emits.
 */
export interface RecursiveSpawnSpec {
  readonly entry: WorkerEntryDescriptor;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

/** Argument shape the runtime-js `execSync` shim writes into the request. */
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
 * the bytes (or `null` when absent). The kernel does not own the VFS;
 * runtime-js wires this when the host's `globalProcessManager` registers
 * its execSync handler so the same source-of-truth (`syncMirror()`) feeds
 * both same-realm and SAB paths.
 */
export type ScriptResolver = (path: string) => Uint8Array | null;

/**
 * Caller-supplied Worker runner: given a script and identity, spawns a
 * fresh kernel Worker, captures its stdout, and resolves with the bytes
 * once it exits. Decoupled from `spawnKernelWorker` itself so the handler
 * can stay testable (the conformance test substitutes an in-process
 * implementation).
 */
export type RecursiveWorkerRunner = (spec: RecursiveSpawnSpec) => Promise<{
  readonly stdout: Uint8Array;
  readonly exitCode: number;
}>;

export interface DefaultHandlerOptions {
  /** PID of the worker requesting the syscall. Used as ppid for children. */
  readonly callerPid: number;
  readonly resolveScript: ScriptResolver;
  readonly runWorker: RecursiveWorkerRunner;
}

/**
 * Register the kernel's built-in sync syscall handlers onto a dispatcher.
 * Idempotent — re-registering the same dispatcher replaces the handlers
 * (per {@link SyncRpcDispatcher.register} semantics).
 */
export function registerDefaultHandlers(
  dispatcher: SyncRpcDispatcher,
  opts: DefaultHandlerOptions,
): void {
  dispatcher.register('execSync', async (rawPayload) => {
    const payload = coerceExecSyncPayload(rawPayload);
    const tokens = payload.cmd.split(/\s+/).filter(Boolean);
    if (tokens[0] !== 'node' || tokens.length < 2) {
      throw Object.assign(new Error(`execSync only supports 'node <script>': got ${payload.cmd}`), {
        code: 'EUNSUPPORTED',
      });
    }
    const scriptPath = tokens[1] ?? '';
    const sourceBytes = opts.resolveScript(scriptPath);
    if (sourceBytes === null) {
      throw Object.assign(new Error(`execSync: script not found: ${scriptPath}`), {
        code: 'ENOENT',
      });
    }
    const source = new TextDecoder().decode(sourceBytes);
    const result = await opts.runWorker({
      entry: { kind: 'source', code: source, sourceUrl: scriptPath },
      argv: ['rifty', scriptPath, ...tokens.slice(2)],
      env: payload.opts?.env ?? {},
      cwd: payload.opts?.cwd ?? '/workspace',
    } satisfies RecursiveSpawnSpec);
    if (result.exitCode !== 0) {
      throw Object.assign(
        new Error(`Command failed with exit code ${result.exitCode}: ${payload.cmd}`),
        { code: 'ECHILDFAILED', exitCode: result.exitCode },
      );
    }
    return new TextDecoder().decode(result.stdout);
  });
  // The callerPid is unused for execSync today (kernel allocates ppid=1
  // for nested children), but it's part of the contract so the dispatcher
  // can pass it down to handlers that care (e.g. signal delivery).
  void opts.callerPid;
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
