import { describe, expect, it } from 'vitest';
import { createRunBudget } from './budget.ts';

describe('createRunBudget', () => {
  it('allows tool calls under the limit, then trips as budget-exceeded (distinct, sticky)', () => {
    const budget = createRunBudget({ maxToolCalls: 2, runTimeoutMs: 60_000 }, () => 0);
    budget.startRun();
    expect(budget.beforeToolCall()).toBeNull();
    expect(budget.beforeToolCall()).toBeNull();
    const reason = budget.beforeToolCall();
    expect(reason).toBe('budget-exceeded: max tool calls (2) reached');
    expect(budget.exceededReason()).toBe(reason);
  });

  it('trips on wall clock via beforeToolCall AND the timer path', () => {
    let now = 0;
    const budget = createRunBudget({ maxToolCalls: 100, runTimeoutMs: 1_000 }, () => now);
    budget.startRun();
    expect(budget.timeExceeded()).toBeNull();
    now = 1_500;
    expect(budget.beforeToolCall()).toMatch(/^budget-exceeded: run time limit \(1000ms\)/);
    expect(budget.timeExceeded()).toMatch(/^budget-exceeded: run time limit/);
  });

  it('startRun resets counters and the sticky reason', () => {
    const budget = createRunBudget({ maxToolCalls: 1, runTimeoutMs: 60_000 }, () => 0);
    budget.startRun();
    expect(budget.beforeToolCall()).toBeNull();
    expect(budget.beforeToolCall()).not.toBeNull();
    budget.startRun();
    expect(budget.exceededReason()).toBeNull();
    expect(budget.beforeToolCall()).toBeNull();
  });
});
