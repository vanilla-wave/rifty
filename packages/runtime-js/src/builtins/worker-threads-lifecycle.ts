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

  /** Node `worker.unref()`: the running worker stops holding the loop. */
  userUnref(): void {
    this.#userUnrefd = true;
    this.release();
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
  tee?: (chunk: unknown) => void,
): void {
  refEventLoop();
  let released = false;
  const settle = (): void => {
    wrapper.push(null);
    if (released) return;
    released = true;
    unrefEventLoop();
  };
  source.on('data', (chunk) => {
    wrapper.push(chunk);
    if (tee !== undefined) tee(chunk);
  });
  source.once('end', settle);
  source.once('close', settle);
}
