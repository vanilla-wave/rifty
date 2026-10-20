import type { SyncRpcCallerContext, SyncRpcDispatcher } from './ipc/sync-dispatch.ts';
import type { KernelStdioInputReader, KernelSyncApi } from './shared-globals.ts';
import { WorkerInput } from './worker-stdin.ts';

const METHOD = 'kernel.stdin';
const inputs = new WeakMap<SyncRpcCallerContext, WorkerInput>();
const installed = new WeakSet<SyncRpcDispatcher>();

/** The dispatcher attachment, never a guest PID, selects its physical input. */
export function registerWorkerInput(
  dispatcher: SyncRpcDispatcher,
  context: SyncRpcCallerContext,
  notify: () => void,
): { input: WorkerInput; dispose(): void } {
  if (!installed.has(dispatcher)) {
    dispatcher.register(METHOD, (payload, caller) => {
      const input = caller === undefined ? undefined : inputs.get(caller);
      if (!input) throw Object.assign(new Error('worker stdin: closed caller'), { code: 'EBADF' });
      if (typeof payload !== 'object' || payload === null)
        throw new TypeError('invalid stdin request');
      const request = payload as { op?: unknown; length?: unknown; wait?: unknown };
      if (request.op === 'close') {
        input.close();
        return null;
      }
      if (
        request.op !== 'read' ||
        typeof request.length !== 'number' ||
        typeof request.wait !== 'boolean'
      ) {
        throw new TypeError('invalid stdin read');
      }
      return input.read(request.length, request.wait);
    });
    installed.add(dispatcher);
  }
  const input = new WorkerInput(notify);
  inputs.set(context, input);
  return {
    input,
    dispose() {
      inputs.delete(context);
      input.close();
    },
  };
}

export function workerInputReader(api: KernelSyncApi): KernelStdioInputReader {
  return {
    read(length, wait) {
      const result = api.call(METHOD, { op: 'read', length, wait });
      if (result !== null && !(result instanceof Uint8Array))
        throw new TypeError('invalid stdin reply');
      return result;
    },
    close() {
      api.call(METHOD, { op: 'close' });
    },
  };
}
