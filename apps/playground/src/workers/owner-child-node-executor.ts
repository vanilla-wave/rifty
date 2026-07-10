/**
 * Owner-realm `node <file>` child driver (ADR-0155). Foreground run like the bin
 * executor (stream stdout/stderr, Ctrl-C kill→mute, resolve on exit code) PLUS
 * server control: a child posts `rifty:node-listening`
 * which the owner forwards into the preview registry. Spawn injected (real
 * `globalProcessManager.spawnWorker` in prod; fake in unit tests).
 */
import { type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import type { CommandContext } from '@riftydev/shell';
import { isNodeChildMessage } from '../glue/node-child-ipc.ts';
import { runForegroundChild } from '../glue/run-foreground-child.ts';

export function buildNodeChildSpawnSpec(
  entry: string,
  args: readonly string[],
  env: Record<string, string>,
  cwd: string,
  nodeEntryUrl: string,
  tty = false,
): SpawnWorkerSpec {
  const isTTY = tty ? '1' : '0';
  return {
    entry: { kind: 'url', url: nodeEntryUrl },
    argv: ['rifty', entry, ...args],
    // RIFTY_BIN=0 → runNodeEntry(bin:false) imports the entry directly (not a
    // .bin shim). serve:true → kernel keeps it alive; the bootstrap owns the
    // run-vs-serve decision (ADR-0155). RIFTY_NODE_SERVE gates the new path.
    env: {
      ...env,
      RIFTY_BIN: '0',
      RIFTY_REMOTE_FS: '1',
      RIFTY_NODE_SERVE: '1',
      RIFTY_STDIN_IS_TTY: '0',
      RIFTY_STDOUT_IS_TTY: isTTY,
      RIFTY_STDERR_IS_TTY: isTTY,
    },
    cwd,
    serve: true,
  };
}

interface NodeReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}
export interface NodeChildHandle {
  readonly kind: string;
  stdout(): NodeReadable;
  stderr(): NodeReadable;
  on(event: 'exit', listener: (code?: unknown) => void): unknown;
  on(event: 'control', listener: (message: unknown) => void): unknown;
  sendControl(message: unknown): unknown;
  kill(signal?: string): unknown;
}

export interface NodeRunHooks {
  /** Stable id for this run (registry key + label). */
  readonly sid: string;
  readonly onListening: (sid: string, ports: number[], previewScope?: string) => void;
  readonly onExit: (sid: string) => void;
}
export type OwnerNodeExecutor = (
  entry: string,
  args: readonly string[],
  ctx: CommandContext,
  hooks: NodeRunHooks,
) => Promise<number>;

export function createOwnerChildNodeExecutor(
  nodeEntryUrl: string,
  spawn: (spec: SpawnWorkerSpec) => NodeChildHandle = (spec) => {
    const h = globalProcessManager.spawnWorker('node', spec, 1);
    if (h.kind !== 'worker')
      throw new Error(`owner-child-node-executor: expected worker, got ${h.kind}`);
    // After the kind guard TS narrows to WorkerProcessHandle, which structurally
    // satisfies NodeChildHandle: stdout()/stderr() are Readable; on(event,listener)
    // covers the narrowed 'exit'/'control' overloads; kill() returns a value
    // assignable to `unknown`. No cast needed
    // (mirrors owner-child-bin-executor).
    return h;
  },
): OwnerNodeExecutor {
  // `async` so a synchronous `spawn` throw (the kind guard / host-boundary
  // failure) surfaces as a rejected promise, not a sync throw. The spawn + the
  // shared driver's listener registration run before the first suspension.
  return async (entry, args, ctx, hooks) => {
    const handle = spawn(
      buildNodeChildSpawnSpec(entry, args, ctx.env, ctx.cwd, nodeEntryUrl, ctx.isTTY === true),
    );
    // Shared foreground driver (stream/abort/exit). A server child posts
    // `rifty:node-listening` → register a preview slot; the slot is removed on
    // exit. (run-foreground-child owns the exit-before-pre-abort ordering.)
    return runForegroundChild(handle, ctx, {
      onMessage: (m) => {
        if (isNodeChildMessage(m)) hooks.onListening(hooks.sid, m.ports, m.previewScope);
      },
      onExit: () => hooks.onExit(hooks.sid),
    });
  };
}
