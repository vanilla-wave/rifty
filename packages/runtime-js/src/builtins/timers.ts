/**
 * Node-compatible timers. We rely on the host's `setTimeout`/`clearTimeout`/
 * `setInterval`/`clearInterval` and polyfill `setImmediate`/`clearImmediate`
 * via `MessageChannel` (post-task scheduling on browsers; jsdom-like envs in
 * Node tests use a `setTimeout(fn, 0)` fallback).
 */

type ImmediateHandle = { readonly id: number };

const immediateQueue: Array<{ id: number; fn: (...args: unknown[]) => void; args: unknown[] }> = [];
let nextImmediateId = 1;

const channel: MessageChannel | null =
  typeof MessageChannel === 'function' ? new MessageChannel() : null;

if (channel) {
  channel.port1.onmessage = () => {
    const item = immediateQueue.shift();
    if (item) {
      try {
        item.fn(...item.args);
      } catch (err) {
        console.error(err);
      }
    }
  };
}

export function setImmediate(
  fn: (...args: unknown[]) => void,
  ...args: unknown[]
): ImmediateHandle {
  const id = nextImmediateId++;
  immediateQueue.push({ id, fn, args });
  if (channel) channel.port2.postMessage(null);
  else
    setTimeout(() => {
      const idx = immediateQueue.findIndex((q) => q.id === id);
      if (idx === -1) return;
      const [item] = immediateQueue.splice(idx, 1);
      item?.fn(...item.args);
    }, 0);
  return { id };
}

export function clearImmediate(handle: ImmediateHandle | undefined): void {
  if (!handle) return;
  const idx = immediateQueue.findIndex((q) => q.id === handle.id);
  if (idx !== -1) immediateQueue.splice(idx, 1);
}

export const timers = {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate,
  queueMicrotask: globalThis.queueMicrotask,
};

/** Install setImmediate / clearImmediate on globalThis (Node-style). */
export function installTimerGlobals(): void {
  (globalThis as unknown as { setImmediate: typeof setImmediate }).setImmediate = setImmediate;
  (globalThis as unknown as { clearImmediate: typeof clearImmediate }).clearImmediate =
    clearImmediate;
}

export default timers;
