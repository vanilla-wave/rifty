/**
 * Schedules refreshes of the terminal-buffer DOM mirror (`data-terminal-buffer`,
 * read by the UI's serialized-buffer consumers and the e2e suite).
 *
 * A plain reset-on-every-write debounce STARVES under continuous output: each
 * output chunk clears the pending timer, so while a dev server streams the
 * mirror never refreshes — it freezes on whatever was last quiescent. The
 * dev-server-ready marker (written mid-burst) then never lands in the mirror,
 * which is the root of the CI-only "[vite] dev server ready never appears"
 * flake (and the sibling stale-buffer flakes on other terminal assertions).
 *
 * This coalesces tight bursts (debounce) BUT caps the wait: the mirror is
 * guaranteed to refresh within `maxWaitMs` of the first pending write even under
 * unbroken output. Timer + clock are injectable so the starvation guard is a
 * deterministic unit test.
 */
export interface BufferRefreshScheduler {
  /** Request a refresh — coalesced, but never starved past `maxWaitMs`. */
  schedule(): void;
  /** Drop any pending refresh (teardown). */
  cancel(): void;
}

export interface BufferRefreshSchedulerOptions {
  readonly debounceMs?: number;
  readonly maxWaitMs?: number;
  readonly setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly now?: () => number;
}

export function createBufferRefreshScheduler(
  refresh: () => void,
  options: BufferRefreshSchedulerOptions = {},
): BufferRefreshScheduler {
  const debounceMs = options.debounceMs ?? 16;
  const maxWaitMs = options.maxWaitMs ?? 150;
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  const now = options.now ?? (() => performance.now());

  let timer: ReturnType<typeof setTimeout> | undefined;
  // Absolute time the next refresh must not slip past; 0 = no burst in flight.
  let deadline = 0;

  function fire(): void {
    timer = undefined;
    deadline = 0;
    refresh();
  }

  return {
    schedule(): void {
      const t = now();
      if (deadline === 0) deadline = t + maxWaitMs;
      if (timer !== undefined) clearTimer(timer);
      // Debounce by `debounceMs`, but never past the burst's hard deadline so
      // continuous writes cannot starve the mirror.
      const wait = Math.max(0, Math.min(debounceMs, deadline - t));
      timer = setTimer(fire, wait);
    },
    cancel(): void {
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
      deadline = 0;
    },
  };
}
