/**
 * Per-run budgets (ADR-0190 acceptance): max tool calls + wall clock,
 * enforced through Pi's `beforeToolCall` hook plus a wrapper timer. Exceeding
 * a budget is a DISTINCT `budget-exceeded` outcome — never a silent stop.
 */

export interface RunBudgetLimits {
  readonly maxToolCalls: number;
  readonly runTimeoutMs: number;
}

export interface RunBudget {
  /** Reset counters at the start of a run (each `send`). */
  startRun(): void;
  /**
   * Account one tool call about to execute; returns the budget-exceeded
   * reason when a limit is hit (the caller blocks the call + aborts), else null.
   */
  beforeToolCall(): string | null;
  /** Wall-clock check without consuming a tool call (used by the run timer). */
  timeExceeded(): string | null;
  /** The first reason that tripped, if any — sticky until the next run. */
  exceededReason(): string | null;
}

export function createRunBudget(limits: RunBudgetLimits, now: () => number = Date.now): RunBudget {
  let toolCalls = 0;
  let startedAt = now();
  let reason: string | null = null;

  function trip(next: string): string {
    if (reason === null) reason = next;
    return reason;
  }

  return {
    startRun(): void {
      toolCalls = 0;
      startedAt = now();
      reason = null;
    },
    beforeToolCall(): string | null {
      const elapsed = now() - startedAt;
      if (elapsed > limits.runTimeoutMs) {
        return trip(`budget-exceeded: run time limit (${limits.runTimeoutMs}ms) reached`);
      }
      if (toolCalls >= limits.maxToolCalls) {
        return trip(`budget-exceeded: max tool calls (${limits.maxToolCalls}) reached`);
      }
      toolCalls += 1;
      return null;
    },
    timeExceeded(): string | null {
      if (now() - startedAt > limits.runTimeoutMs) {
        return trip(`budget-exceeded: run time limit (${limits.runTimeoutMs}ms) reached`);
      }
      return null;
    },
    exceededReason(): string | null {
      return reason;
    },
  };
}
