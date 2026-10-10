import type { Readable } from '@riftydev/io';
import { ref as refEventLoop, unref as unrefEventLoop } from '../internal/event-loop-keepalive.ts';

/**
 * Worker keepalive + stdio wiring helpers (worker-threads-handle-keepalive /
 * worker-threads-stdio-streams-empty-exec-argv): a live, ref'd Worker holds
 * the parent's loop; piped stdio wrappers end at the HANDLE stream's sealed
 * drain, holding a ref until then (an open pipe holds the loop in Node).
 */

/** ADR-0152 handle-class ref: acquire/release with a user-unref gate. */
export class WorkerKeepaliveRef {
  #held = false;
  #userUnrefd = false;
  #auxHeld = 0;

  acquire(): void {
    if (this.#held || this.#userUnrefd) return;
    this.#held = true;
    refEventLoop();
  }

  release(): void {
    if (!this.#held) return;
    this.#held = false;
    unrefEventLoop();
  }

  /** Piped-stdio aux refs: released wholesale by `unref()` (an unref'd
   * worker's open streams do not hold the loop — Node oracle). */
  acquireAux(): void {
    if (this.#userUnrefd) return;
    this.#auxHeld += 1;
    refEventLoop();
  }

  releaseAux(): void {
    if (this.#auxHeld === 0) return;
    this.#auxHeld -= 1;
    unrefEventLoop();
  }

  /** Node `worker.unref()`: the running worker and its piped streams stop
   * holding the loop. */
  userUnref(): void {
    this.#userUnrefd = true;
    this.release();
    while (this.#auxHeld > 0) {
      this.#auxHeld -= 1;
      unrefEventLoop();
    }
  }

  /** Node `worker.ref()`: re-acquire the hold (no-op once exited). */
  userRef(exited: boolean): void {
    this.#userUnrefd = false;
    if (!exited) this.acquire();
  }
}

/** Pipe a kernel handle stdio stream into a construction-time wrapper. The
 * wrapper ends when the HANDLE stream ends (sealed output drains after the
 * exit event), holding a keepalive ref until then. `tee` (the unpiped
 * default) also delivers every chunk to the parent's inherited stdio, as
 * Node does when `stdout: true` is absent. */
export function pipeHandleStdioStream(
  source: Readable,
  wrapper: Readable,
  keepalive?: WorkerKeepaliveRef,
  tee?: (chunk: unknown) => void,
): void {
  if (keepalive === undefined) refEventLoop();
  else keepalive.acquireAux();
  let released = false;
  const settle = (): void => {
    wrapper.push(null);
    if (released) return;
    released = true;
    if (keepalive === undefined) unrefEventLoop();
    else keepalive.releaseAux();
  };
  source.on('data', (chunk) => {
    wrapper.push(chunk);
    if (tee !== undefined) tee(chunk);
  });
  source.once('end', settle);
  source.once('close', settle);
}
