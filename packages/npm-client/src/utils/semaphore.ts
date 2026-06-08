/**
 * Zero-dep FIFO counting semaphore (#24, perf-audit 2026-06-05). Bounds the
 * number of concurrently-running async tasks to `max`. Internal to npm-client
 * (not exported from `src/index.ts`); used to cap parallel tarball fetches while
 * the placement walk stays serial. Single-threaded JS, so no permit race: a
 * released permit is handed straight to the next FIFO waiter.
 */
export class Semaphore {
  private permits: number;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    if (max < 1) throw new RangeError(`Semaphore max must be >= 1, got ${max}`);
    this.permits = max;
  }

  private async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next(); // hand the permit directly to the waiter (FIFO, never drops below cap)
    } else {
      this.permits++;
    }
  }

  /** Run `fn` once a permit is free; release on both fulfilment and rejection. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
