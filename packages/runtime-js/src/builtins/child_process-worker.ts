/**
 * Worker-backed `child_process.spawn` path (ADR-0011 phase 2 + ADR-0045).
 *
 * When SAB-IPC is supported and the host has set the kernel worker URL,
 * `child_process.spawn` routes through `globalProcessManager.spawnWorker(...)`
 * instead of the in-realm `execScript` fallback. This module only translates a
 * `node <script>` invocation into a {@link SpawnWorkerSpec}.
 *
 * Fork-IPC (ADR-0045) is owned by the kernel `WorkerProcessHandle.send` /
 * `disconnect` and runtime-js `installNodeProcessShim`; this module no longer
 * plumbs IPC buses. Stdio adaptation lives one layer down in the kernel
 * `WorkerProcessHandle.stdout()` / `stderr()`.
 *
 * NOT in scope: `execSync` truly blocking via `Atomics.wait` (ADR-0011 phase 3);
 * `execSync` stays on the in-realm path.
 */

import { Buffer, type EventEmitter } from '@riftydev/io';
import { type ProcessHandle, type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import { syncMirror } from './fs-sync-mirror.ts';

export interface SpawnWorkerArgs {
  command: string;
  args: string[];
  opts: { cwd?: string; env?: Record<string, string>; __fork?: boolean };
  /** Bus for IPC messages received from the worker (fork-mode only). */
  outboundMessages: EventEmitter;
  /** Bus listened to for IPC messages destined for the worker (fork-mode only). */
  inboundIpc: EventEmitter;
}

/**
 * Build a {@link SpawnWorkerSpec} for `node <script>` and start the worker.
 * Read stdio via `handle.stdout()` / `handle.stderr()`.
 *
 * @throws if command is not `'node'` (the worker can't model ENOENT; callers
 *   must keep non-node commands on the in-realm fallback), or if args[0] is
 *   missing / the script isn't in the sync mirror.
 */
export function spawnWorkerChild(args: SpawnWorkerArgs): ProcessHandle {
  if (args.command !== 'node') {
    throw new Error(
      `spawnWorkerChild: only 'node' is supported; got ${args.command}. Non-node commands must stay on the in-realm fallback.`,
    );
  }
  const scriptPath = args.args[0];
  if (!scriptPath) {
    throw new Error('spawnWorkerChild: missing script path (args[0])');
  }
  const sourceBytes = syncMirror().readFileBytesSync(scriptPath);
  const source = Buffer.from(sourceBytes).toString();

  const spec: SpawnWorkerSpec = {
    entry: { kind: 'source', code: source, sourceUrl: scriptPath },
    argv: ['rifty', scriptPath, ...args.args.slice(1)],
    env: args.opts.env ?? {},
    cwd: args.opts.cwd ?? '/workspace',
  };

  const handle = globalProcessManager.spawnWorker(args.command, spec, /* ppid */ 1, {
    cwd: args.opts.cwd,
  });

  // ADR-0045: fork IPC flows through the kernel handle now; these buses are
  // vestigial, kept in the interface for caller signature stability.
  void args.outboundMessages;
  void args.inboundIpc;
  return handle;
}
