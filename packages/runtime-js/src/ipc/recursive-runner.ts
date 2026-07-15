/**
 * Recursive Worker runner for the runtime-js `'execSync'` sync RPC handler
 * (ADR-0011 phase 3, ADR-0039, ADR-0137, ADR-0150).
 *
 * Owns the ENTRY-KIND DECISION for `execSync('node <script>')` — the handler
 * passes the script PATH (no longer the bytes), and the runner picks how to run
 * it. BOTH routes go through the runtime-js module loader (`runNodeEntry`), so a
 * `#!` shebang is stripped and relative `import`/`require` resolve against the
 * VFS — the parity ADR-0137 already gives `child_process.spawn('node', …)`:
 *
 *  - {@link makeRecursiveRunner} (the BROWSER/owner seam, production default,
 *    HERE): spawns a node-entry child `kind:'url'` with a remote-FS launch payload,
 *    run-to-completion. The child reads the OWNER store over the P6a `fs.*`
 *    sync-RPC (ADR-0150) — SAME spawn shape as `owner-child-bin-executor`/
 *    `owner-child-node-executor`, minus `serve` (execSync captures stdout +
 *    exits, never listens). Requires the spawning realm to serve `fs.*` (only
 *    the owner does today) and `setNodeEntryWorkerUrl(...)` to be wired; a realm
 *    missing either fails LOUD here (never a silent empty-mirror ENOENT child).
 *  - `makeInProcessNodeEntryRunner` (the Node-conformance seam, separate file
 *    `in-process-node-entry-runner.ts` so the production `child_process → handlers
 *    → recursive-runner` cold-start graph does NOT pull the module loader — same
 *    madge-cycle care as `node-entry-url.ts`): loader-runs the source IN-PROCESS
 *    via `runNodeEntry`, no kernel Worker / `kind:'url'` bootstrap.
 *
 * Lives in `@riftydev/runtime-js` (post-ADR-0039) so the kernel stays free of
 * Node-API knowledge. Imports flow top-down (`runtime-js` → `@riftydev/kernel`),
 * so the runner statically imports `spawnKernelWorker`.
 */

import { spawnKernelWorker } from '@riftydev/kernel';
import { buildConfiguredNodeEntryWorkerEntry } from '../builtins/node-entry-runtime-config.ts';
import { getNodeEntryWorkerUrl } from '../builtins/node-entry-url.ts';

/**
 * What the handler hands the runner: the resolved script PATH (in the owner /
 * sync-mirror store) plus the child's argv/env/cwd. The handler no longer
 * embeds the script BYTES — the runner reads them through the module loader so
 * the shebang/relative-import path applies (ADR-0137).
 */
export interface NodeEntryRunSpec {
  /** Absolute VFS path of the `node <script>` entry. */
  readonly entryPath: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

/** Captured stdout bytes and child exit code the runner resolves with. */
export interface RecursiveRunResult {
  readonly stdout: Uint8Array;
  readonly exitCode: number;
  /**
   * Captured stderr bytes. Node's `execSync` surfaces the child's stderr ONLY on
   * failure (via the thrown error), so the handler attaches this to the
   * ECHILDFAILED error and discards it on success. Empty when none.
   */
  readonly stderr?: Uint8Array;
}

/** A runner: turn a {@link NodeEntryRunSpec} into the child's stdout + exit. */
export type NodeEntryRunner = (spec: NodeEntryRunSpec) => Promise<RecursiveRunResult>;

/** Node's child env snapshot. Host bootstrap and launch controls travel out of band. */
export function buildRecursiveWorkerEnv(
  userEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...userEnv };
}

/**
 * Browser/owner runner: spawn a node-entry child `kind:'url'` (the ADR-0137
 * bootstrap) with a typed remote-FS launch, capture its stdout, resolve on exit.
 *
 * Run-to-completion (no `serve`): the bootstrap's else-branch runs
 * `runNodeEntry` and exits on settle, so `onExit` fires and the stdout port
 * EOFs — exactly what a synchronous `execSync` needs.
 *
 * The child reads the OWNER store over `fs.*` sync-RPC: its `readKernelSyncApi().
 * call('fs.*', …)` writes to its own SAB ring, serviced by the singleton kernel
 * dispatcher in THIS (spawning) realm — so the realm must have
 * `installRuntimeJsFsHandlers(...)` registered (the owner does, ADR-0150).
 *
 * PIDs start at `0xC0000000`, a dedicated counter that avoids colliding with the
 * main `ProcessManager`'s PID space — recursive children are an internal
 * `execSync`-blocking detail, not tracked in the public process table.
 */
export function makeRecursiveRunner(): NodeEntryRunner {
  let nextNestedPid = 0xc0000000;
  return (spec) => {
    const url = getNodeEntryWorkerUrl();
    if (url === null) {
      // Loud, never a silent empty-mirror child: a `kind:'url'` node-entry child
      // needs the bootstrap worker URL. Reachable only from a realm that serves
      // `fs.*` (the owner) — if the host hasn't wired the node-entry URL there,
      // fail at the spawn site rather than spawn an ENOENT child.
      // TODO(backlog: runtime-js/generic-spawn-worker-remote-fs)
      throw new Error(
        'recursive-runner: node-entry worker URL not configured — call ' +
          'setNodeEntryWorkerUrl(...) at host boot so execSync can route ' +
          '`node <script>` through the node-entry bootstrap (shebang + relative imports)',
      );
    }
    const env = buildRecursiveWorkerEnv(spec.env);
    const entry = buildConfiguredNodeEntryWorkerEntry({
      kind: 'program',
      bin: false,
      remoteFs: true,
      nodeServe: false,
    });
    const nestedPid = nextNestedPid++;
    const nested = spawnKernelWorker(
      {
        entry,
        // The URL-entry payload says bin:false + remoteFs:true + nodeServe:false:
        // execSync reads the owner store, runs to completion, and never exposes
        // these runtime controls through the guest's Node environment.
        argv: spec.argv,
        env,
        cwd: spec.cwd,
      },
      { pid: nestedPid, ppid: 1 },
    );
    const chunks: Uint8Array[] = [];
    nested.ports.stdout.onmessage = (ev) => {
      const data = ev.data;
      if (data instanceof Uint8Array) chunks.push(data);
    };
    nested.ports.stdout.start();
    // Capture stderr too: Node's `execSync` defaults `stdio[2]` to `'pipe'` and
    // surfaces the child's stderr ONLY on failure via the thrown error. The
    // handler attaches it to ECHILDFAILED and drops it on success — so a child
    // that throws (e.g. a module-not-found) gets its real diagnostic surfaced,
    // not an opaque exit code.
    const errChunks: Uint8Array[] = [];
    nested.ports.stderr.onmessage = (ev) => {
      const data = ev.data;
      if (data instanceof Uint8Array) errChunks.push(data);
    };
    nested.ports.stderr.start();
    // The kernel writes an uncaught child throw's stack to the child stderr just
    // before it posts the exit message; that stderr chunk is delivered on a
    // queueMicrotask flush, so defer reading errChunks one microtask past the
    // exit so a same-tick exit does not race the diagnostic out.
    return new Promise((resolve) => {
      nested.onExit((code) => {
        queueMicrotask(() => {
          resolve({
            stdout: concatChunks(chunks),
            exitCode: code,
            stderr: concatChunks(errChunks),
          });
        });
      });
    });
  };
}

/** Concatenate captured stdout chunks into one byte-exact buffer. */
export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
