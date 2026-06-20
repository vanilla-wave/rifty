/**
 * Owner-realm `node <file>` child driver (ADR-0155). Foreground run like the bin
 * executor (stream stdout/stderr, Ctrl-C kill→mute, resolve on exit code) PLUS
 * the dev-server child's fork-IPC: a server child posts `rifty:node-listening`
 * which the owner forwards into the preview registry. Spawn injected (real
 * `globalProcessManager.spawnWorker` in prod; fake in unit tests).
 */
import { type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import type { CommandContext } from '@riftydev/shell';
import { isNodeChildMessage } from '../glue/node-child-ipc.ts';

export function buildNodeChildSpawnSpec(
  entry: string,
  args: readonly string[],
  env: Record<string, string>,
  cwd: string,
  nodeEntryUrl: string,
): SpawnWorkerSpec {
  return {
    entry: { kind: 'url', url: nodeEntryUrl },
    argv: ['rifty', entry, ...args],
    // RIFTY_BIN=0 → runNodeEntry(bin:false) imports the entry directly (not a
    // .bin shim). serve:true → kernel keeps it alive; the bootstrap owns the
    // run-vs-serve decision (ADR-0155). RIFTY_NODE_SERVE gates the new path.
    env: { ...env, RIFTY_BIN: '0', RIFTY_REMOTE_FS: '1', RIFTY_NODE_SERVE: '1' },
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
  on(event: 'message', listener: (message: unknown) => void): unknown;
  send(message: unknown): unknown;
  kill(signal?: string): unknown;
}

export interface NodeRunHooks {
  /** Stable id for this run (registry key + label). */
  readonly sid: string;
  readonly onListening: (sid: string, ports: number[]) => void;
  readonly onExit: (sid: string) => void;
}
export type OwnerNodeExecutor = (
  entry: string,
  args: readonly string[],
  ctx: CommandContext,
  hooks: NodeRunHooks,
) => Promise<number>;

const decoder = new TextDecoder();
function decodeChunk(chunk: unknown): string {
  if (chunk instanceof Uint8Array) return decoder.decode(chunk);
  if (chunk instanceof ArrayBuffer) return decoder.decode(new Uint8Array(chunk));
  if (ArrayBuffer.isView(chunk)) {
    return decoder.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return typeof chunk === 'string' ? chunk : '';
}

export function createOwnerChildNodeExecutor(
  nodeEntryUrl: string,
  spawn: (spec: SpawnWorkerSpec) => NodeChildHandle = (spec) => {
    const h = globalProcessManager.spawnWorker('node', spec, 1);
    if (h.kind !== 'worker')
      throw new Error(`owner-child-node-executor: expected worker, got ${h.kind}`);
    // After the kind guard TS narrows to WorkerProcessHandle, which structurally
    // satisfies NodeChildHandle: stdout()/stderr() are Readable; on(event,listener)
    // (wide EventEmitter sig) covers the narrowed 'exit'/'message' overloads;
    // send()/kill() return values are assignable to `unknown`. No cast needed
    // (mirrors owner-child-bin-executor).
    return h;
  },
): OwnerNodeExecutor {
  return (entry, args, ctx, hooks) =>
    new Promise<number>((resolve) => {
      const handle = spawn(buildNodeChildSpawnSpec(entry, args, ctx.env, ctx.cwd, nodeEntryUrl));
      let outputClosed = false;
      const stream = (chunk: unknown, w: { write(s: string): void }): void => {
        if (outputClosed) return;
        const text = decodeChunk(chunk);
        if (text) w.write(text);
      };
      handle.stdout().on('data', (c) => stream(c, ctx.stdout));
      handle.stderr().on('data', (c) => stream(c, ctx.stderr));

      handle.on('message', (m: unknown) => {
        if (isNodeChildMessage(m)) hooks.onListening(hooks.sid, m.ports);
      });

      const signal = ctx.signal;
      const onAbort = (): void => {
        outputClosed = true;
        handle.kill('SIGTERM');
      };

      // Register the exit listener BEFORE acting on an already-aborted signal:
      // `kill()` emits 'exit' synchronously, so a pre-aborted run would otherwise
      // lose the event → the promise never resolves + onExit (registry remove)
      // never fires.
      let settled = false;
      handle.on('exit', (code) => {
        if (settled) return;
        settled = true;
        outputClosed = true;
        signal?.removeEventListener('abort', onAbort);
        hooks.onExit(hooks.sid);
        resolve(typeof code === 'number' ? code : 0);
      });

      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
}
