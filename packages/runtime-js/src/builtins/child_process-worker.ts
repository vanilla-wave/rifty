/**
 * Worker-backed `child_process.spawn` path (ADR-0011 phase 2).
 *
 * When `isSabIpcSupported()` is `true` AND the host has called
 * `setKernelWorkerUrl(...)`, `child_process.spawn` routes through
 * `globalProcessManager.spawnWorker(...)` instead of the in-realm
 * `execScript` fallback. This module owns:
 *
 *   - The translation of a `node <script>` invocation into a
 *     {@link WorkerSpawnSpec} (script bytes from the sync mirror, argv, env,
 *     cwd).
 *   - The IPC wiring for `fork()` — a dedicated `MessageChannel` carries
 *     `{type:'message', payload}` frames between the parent and the worker
 *     via `process.send` / `process.on('message')` (phase 2 surface; the
 *     worker-entry runtime that consumes it lands alongside).
 *
 * Stdio adaptation lives one layer down: `handle.stdout()` / `handle.stderr()`
 * on the kernel `WorkerProcessHandle` return the `@rifty/io` `Readable`s
 * already wired to the worker's stdio `MessagePort`s with EOF on exit
 * (ADR-0011 phase 2 follow-up, follow-ups doc item #3). This module no
 * longer hand-rolls `port.onmessage` / `port.start()` / push-null plumbing.
 *
 * NOT in scope: `execSync` truly blocking via `Atomics.wait` — that is
 * ADR-0011 phase 3. The current `execSync` stays on the in-realm path.
 */

import { Buffer, type EventEmitter } from '@rifty/io';
import { type ProcessHandle, type SpawnWorkerSpec, globalProcessManager } from '@rifty/kernel';
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
 * Build a {@link WorkerSpawnSpec} for `node <script>` and start the
 * worker. Returns the kernel `ProcessHandle` — read stdio via
 * `handle.stdout()` / `handle.stderr()`.
 *
 * Throws when:
 *   - command is not `'node'` (we'd want ENOENT behaviour, but the worker
 *     can't model that — callers must check upstream and stay on the
 *     in-realm fallback for non-`node` commands).
 *   - args[0] is missing or the script doesn't exist in the sync mirror.
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
  // Read source bytes synchronously from the shared VFS mirror.
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

  // fork-mode IPC is reserved for the runtime-side worker that surfaces
  // `process.send` / `process.on('message')`. The host-side plumbing is the
  // outbound + inbound buses; phase 3 fills in the worker-entry wiring.
  void args.outboundMessages;
  void args.inboundIpc;
  return handle;
}
