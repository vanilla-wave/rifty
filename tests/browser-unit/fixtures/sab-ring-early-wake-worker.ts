/// <reference lib="webworker" />

import { SabRing } from '../../../packages/kernel/src/ipc/sab-ring.ts';

type WaitResult = 'ok' | 'not-equal' | 'timed-out';
type Wait = (typedArray: Int32Array, index: number, value: number, timeout?: number) => WaitResult;

interface RunMessage {
  readonly sab: SharedArrayBuffer;
  readonly payloadCapacity: number;
}

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<RunMessage>) => {
  const caller = SabRing.attach(event.data.sab, event.data.payloadCapacity);
  const atomics = Atomics as unknown as { wait: Wait };
  const originalWait = atomics.wait;
  const nativeWait = originalWait.bind(Atomics);
  let earlyWakeInjected = false;
  let waitCalls = 0;

  atomics.wait = (words, index, value, timeout) => {
    waitCalls++;
    if (!earlyWakeInjected) {
      earlyWakeInjected = true;
      scope.postMessage({ type: 'early-wake' });
      return 'ok';
    }
    return nativeWait(words, index, value, timeout);
  };

  try {
    caller.writeRequest(new Uint8Array([1, 2, 3]));
    const reply = caller.waitReply(2_000);
    scope.postMessage({
      type: 'done',
      reply: Array.from(reply),
      earlyWakeInjected,
      waitCalls,
    });
  } catch (error) {
    scope.postMessage({
      type: 'failed',
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      earlyWakeInjected,
      waitCalls,
    });
  } finally {
    atomics.wait = originalWait;
  }
});
