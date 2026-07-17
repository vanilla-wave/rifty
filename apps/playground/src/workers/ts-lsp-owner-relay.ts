import { type SpawnWorkerSpec, globalProcessManager } from '@riftydev/kernel';
import type { TsRequestMessage, TsResponseMessage } from '@riftydev/ts-language-service/protocol';
import { ClosedHandleError } from '../workbench/errors.ts';
import {
  assertSessionToolsTsRequestScope,
  inspectSessionToolsTsRequestMessage,
  inspectSessionToolsTsResponseMessage,
} from '../workbench/internal/playground-session-tools-transport.ts';
import type { OwnerPackageState } from './owner-package-state.ts';

interface ChildReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

export interface TsLspChildHandle {
  readonly kind: string;
  send(message: unknown): boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code?: unknown, signal?: unknown) => void): unknown;
  stdout(): ChildReadable;
  stderr(): ChildReadable;
  kill(signal?: string): boolean;
}

export interface TsLspOwnerRelayOptions {
  readonly projectRoot: string;
  readonly workerUrl: string;
  readonly nodeWorkerRuntimeEnv: Readonly<Record<string, string>>;
  readonly packages: Pick<OwnerPackageState, 'quiesce'>;
  readonly send: (message: TsResponseMessage) => boolean | undefined;
  readonly log: (line: string) => void;
  /** Test seam at the real kernel worker-spawn boundary. */
  readonly spawnWorker?: (spec: SpawnWorkerSpec) => TsLspChildHandle;
}

export interface TsLspOwnerRelay {
  handle(message: TsRequestMessage): Promise<void>;
  close(): Promise<void>;
}

interface ActiveChild {
  readonly handle: TsLspChildHandle;
  readonly exited: Promise<void>;
  resolveExit(): void;
  exitedFlag: boolean;
}

const decoder = new TextDecoder();

function decodeChunk(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) return decoder.decode(chunk);
  if (chunk instanceof ArrayBuffer) return decoder.decode(new Uint8Array(chunk));
  if (ArrayBuffer.isView(chunk)) {
    return decoder.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return '';
}

function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function spawnSpec(options: TsLspOwnerRelayOptions): SpawnWorkerSpec {
  return {
    entry: { kind: 'url', url: options.workerUrl },
    argv: ['rifty', 'ts-lsp'],
    env: {
      ...options.nodeWorkerRuntimeEnv,
      RIFTY_REMOTE_FS: '1',
      RIFTY_RFV_ROOT: options.projectRoot,
    },
    cwd: options.projectRoot,
    serve: true,
  };
}

/** PR136's real grandchild relay, narrowed to one semantic Workbench session. */
export function createTsLspOwnerRelay(options: TsLspOwnerRelayOptions): TsLspOwnerRelay {
  const spawn =
    options.spawnWorker ??
    ((spec: SpawnWorkerSpec): TsLspChildHandle => {
      const handle = globalProcessManager.spawnWorker('ts-lsp', spec, 1);
      if (handle.kind !== 'worker') {
        throw new Error(`ts-lsp child: expected worker handle, got ${handle.kind}`);
      }
      return handle;
    });
  const pending = new Set<number>();
  let active: ActiveChild | null = null;
  let accepting = true;
  let tail: Promise<void> = Promise.resolve();
  let closePromise: Promise<void> | null = null;

  const send = (message: TsResponseMessage): void => {
    const inspected = inspectSessionToolsTsResponseMessage(message);
    if (options.send(inspected) === false) {
      throw new Error('TypeScript owner relay transport refused a response');
    }
  };

  const sendFailure = (id: number, reason: unknown): void => {
    const error = errorFrom(reason);
    send({
      type: 'rifty:ts-lsp',
      response: {
        id,
        ok: false,
        kind: 'error',
        error: {
          name: error.name.length > 0 ? error.name : 'Error',
          message: error.message,
        },
      },
    });
  };

  const failPending = (reason: unknown): void => {
    const ids = [...pending];
    pending.clear();
    for (const id of ids) {
      try {
        sendFailure(id, reason);
      } catch (error) {
        options.log(
          `[workbench/ts-lsp] failed to publish request ${String(id)} failure: ${errorFrom(error).message}\n`,
        );
      }
    }
  };

  const corruptChild = (child: ActiveChild, reason: unknown): void => {
    const error = errorFrom(reason);
    failPending(error);
    if (active === child) active = null;
    try {
      child.handle.kill('SIGTERM');
    } catch (killError) {
      options.log(
        `[workbench/ts-lsp] corrupt child kill failed: ${errorFrom(killError).message}\n`,
      );
    }
  };

  const spawnChild = (): ActiveChild => {
    const handle = spawn(spawnSpec(options));
    if (handle.kind !== 'worker') {
      throw new Error(`ts-lsp child: expected worker handle, got ${handle.kind}`);
    }
    let resolveExit!: () => void;
    const child: ActiveChild = {
      handle,
      exited: new Promise<void>((resolve) => {
        resolveExit = resolve;
      }),
      resolveExit: () => resolveExit(),
      exitedFlag: false,
    };

    handle.stdout().on('data', (chunk) => {
      const text = decodeChunk(chunk);
      if (text.length > 0) options.log(text);
    });
    handle.stderr().on('data', (chunk) => {
      const text = decodeChunk(chunk);
      if (text.length > 0) options.log(text);
    });
    handle.on('message', (candidate) => {
      if (active !== child || child.exitedFlag) return;
      let response: TsResponseMessage;
      try {
        response = inspectSessionToolsTsResponseMessage(candidate);
        if (!pending.has(response.response.id)) {
          throw new TypeError(
            `Invalid session tools TS response: unknown id ${String(response.response.id)}`,
          );
        }
      } catch (error) {
        corruptChild(child, error);
        return;
      }
      pending.delete(response.response.id);
      try {
        send(response);
      } catch (error) {
        corruptChild(child, error);
      }
    });
    handle.on('exit', (code, signal) => {
      if (child.exitedFlag) return;
      child.exitedFlag = true;
      child.resolveExit();
      if (active === child) active = null;
      options.log(
        `[workbench/ts-lsp] child exited (code ${String(code)}, signal ${String(signal)})\n`,
      );
      if (pending.size > 0) {
        failPending(
          new Error(
            `TypeScript language-service child exited (code ${String(code)}, signal ${String(signal)})`,
          ),
        );
      }
    });
    return child;
  };

  const forward = async (message: TsRequestMessage): Promise<void> => {
    try {
      assertSessionToolsTsRequestScope(message, options.projectRoot);
      await options.packages.quiesce();
      if (!accepting) throw new ClosedHandleError('TypeScript owner relay');
      if (pending.has(message.request.id)) {
        throw new TypeError(
          `TypeScript request id ${String(message.request.id)} is already pending`,
        );
      }
      if (active === null) active = spawnChild();
      pending.add(message.request.id);
      if (!active.handle.send(message)) {
        pending.delete(message.request.id);
        throw new Error('TypeScript language-service child refused a request');
      }
    } catch (error) {
      sendFailure(message.request.id, error);
    }
  };

  const handle = (candidate: TsRequestMessage): Promise<void> => {
    if (!accepting) return Promise.reject(new ClosedHandleError('TypeScript owner relay'));
    let message: TsRequestMessage;
    try {
      message = inspectSessionToolsTsRequestMessage(candidate);
    } catch (error) {
      return Promise.reject(error);
    }
    const operation = tail.then(() => forward(message));
    tail = operation.catch(() => {});
    return operation;
  };

  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise;
    accepting = false;
    closePromise = (async () => {
      await tail;
      const child = active;
      if (child === null) return;
      active = null;
      failPending(new ClosedHandleError('TypeScript owner relay'));
      if (!child.exitedFlag) {
        const killed = child.handle.kill('SIGTERM');
        if (!killed && !child.exitedFlag) {
          throw new Error('TypeScript language-service child refused SIGTERM without exiting');
        }
      }
      await child.exited;
    })();
    return closePromise;
  };

  return Object.freeze({ handle, close });
}
