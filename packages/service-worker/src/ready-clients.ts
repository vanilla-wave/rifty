/**
 * SW-side handshake state machine. Tracks which window clients have completed
 * the `rifty:preview:ready` handshake, which ones posted a mismatched protocol
 * version, and lets a fetch handler wait for a client to become ready (bounded
 * by a timeout).
 *
 * Lives in its own module to keep `preview-bridge.ts` under the ADR-0024
 * file-size budget.
 */

import { SW_PREVIEW_GOODBYE, SW_PREVIEW_READY, SW_PROTOCOL_VERSION } from './protocol.ts';

/**
 * Pending waiter for a not-yet-ready client. Resolves once the client's
 * `rifty:preview:ready` frame arrives or once the timeout fires.
 */
interface ReadyWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
}

export interface ReadyClientsRegistry {
  /** Is the client currently considered ready? */
  isReady(id: string): boolean;
  /** Has the client posted a mismatched protocol version? */
  isMismatched(id: string): boolean;
  /**
   * Wait until the given client is ready, or until `timeoutMs` elapses.
   * Resolves with `'ready'` on success, `'timeout'` when the timer fires,
   * and `'mismatch'` if the client posted a mismatched protocol version
   * mid-wait.
   */
  waitForReady(id: string, timeoutMs: number): Promise<'ready' | 'timeout' | 'mismatch'>;
  /**
   * Process a message frame from a client. Updates the ready set / mismatch
   * set and resolves any pending waiters. Frames whose `type` is none of
   * `rifty:preview:ready` / `rifty:preview:goodbye` are ignored.
   */
  handleMessage(clientId: string, data: { type?: unknown; version?: unknown }): void;
  /**
   * Allocate the next outbound request id for `rifty:preview:request` frames
   * dispatched on behalf of this interceptor. Each registry owns its own
   * counter so multiple interceptors in the same process (tests) don't share
   * monotonically-increasing state.
   */
  nextRequestId(): number;
}

export interface ReadyClientsLogger {
  warn(message: string): void;
}

const defaultLogger: ReadyClientsLogger = {
  warn(msg: string): void {
    // eslint-disable-next-line no-console
    console.warn(msg);
  },
};

/**
 * Build a fresh registry. Each interceptor instance gets its own — never
 * shared across instances (so tests in the same process don't bleed state).
 */
export function createReadyClientsRegistry(
  logger: ReadyClientsLogger = defaultLogger,
): ReadyClientsRegistry {
  const ready = new Set<string>();
  const waiters = new Map<string, Set<ReadyWaiter>>();
  const mismatched = new Set<string>();
  const warned = new Set<string>();
  let nextRequestIdCounter = 1;

  function markReady(id: string): void {
    ready.add(id);
    const waiterSet = waiters.get(id);
    if (waiterSet) {
      for (const w of waiterSet) w.resolve();
      waiters.delete(id);
    }
  }

  function markGoodbye(id: string): void {
    ready.delete(id);
    const waiterSet = waiters.get(id);
    if (waiterSet) {
      for (const w of waiterSet) {
        w.reject(new Error('client departed during handshake'));
      }
      waiters.delete(id);
    }
  }

  function failWaitersWithMismatch(id: string): void {
    const waiterSet = waiters.get(id);
    if (waiterSet) {
      for (const w of waiterSet) w.reject(new Error('protocol version mismatch'));
      waiters.delete(id);
    }
  }

  return {
    isReady(id): boolean {
      return ready.has(id);
    },
    isMismatched(id): boolean {
      return mismatched.has(id);
    },
    waitForReady(id, timeoutMs): Promise<'ready' | 'timeout' | 'mismatch'> {
      if (mismatched.has(id)) return Promise.resolve('mismatch');
      if (ready.has(id)) return Promise.resolve('ready');
      return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const waiter: ReadyWaiter = {
          resolve: (): void => {
            if (timer !== null) clearTimeout(timer);
            resolve('ready');
          },
          reject: (err: Error): void => {
            if (timer !== null) clearTimeout(timer);
            resolve(err.message === 'protocol version mismatch' ? 'mismatch' : 'timeout');
          },
        };
        const set = waiters.get(id) ?? new Set<ReadyWaiter>();
        set.add(waiter);
        waiters.set(id, set);
        timer = setTimeout(() => {
          const s = waiters.get(id);
          if (s) {
            s.delete(waiter);
            if (s.size === 0) waiters.delete(id);
          }
          resolve('timeout');
        }, timeoutMs);
      });
    },
    handleMessage(clientId, data): void {
      const type = data?.type;
      if (type !== SW_PREVIEW_READY && type !== SW_PREVIEW_GOODBYE) return;
      if (data.version !== SW_PROTOCOL_VERSION) {
        if (!warned.has(clientId)) {
          warned.add(clientId);
          logger.warn(
            `[rifty/service-worker] protocol version mismatch from client ${clientId}: got ${String(
              data.version,
            )}, want ${SW_PROTOCOL_VERSION}`,
          );
        }
        mismatched.add(clientId);
        failWaitersWithMismatch(clientId);
        return;
      }
      if (type === SW_PREVIEW_READY) {
        markReady(clientId);
      } else {
        markGoodbye(clientId);
      }
    },
    nextRequestId(): number {
      return nextRequestIdCounter++;
    },
  };
}
