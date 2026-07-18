import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaygroundStoreToastDismissal } from './playground-toast-policy.ts';

describe('Playground store toast dismissal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps delete Undo available for its full grace window', () => {
    const dismiss = vi.fn();
    const policy = createPlaygroundStoreToastDismissal(dismiss);

    policy.update({ kind: 'info', text: 'Deleted demo', undo: true });
    vi.advanceTimersByTime(3_199);
    expect(dismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledOnce();
    policy.dispose();
  });

  it('shows Restored and every other store toast for a normal beat', () => {
    const dismiss = vi.fn();
    const policy = createPlaygroundStoreToastDismissal(dismiss);

    policy.update({ kind: 'info', text: 'Restored demo' });
    vi.advanceTimersByTime(2_499);
    expect(dismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledOnce();

    dismiss.mockClear();
    policy.update({ kind: 'error', text: 'Rename failed' });
    vi.advanceTimersByTime(2_500);
    expect(dismiss).toHaveBeenCalledOnce();
    policy.dispose();
  });

  it('replaces or cancels the prior toast deadline without a stale dismissal', () => {
    const dismiss = vi.fn();
    const policy = createPlaygroundStoreToastDismissal(dismiss);

    policy.update({ kind: 'info', text: 'Autosaved' });
    vi.advanceTimersByTime(2_000);
    policy.update({ kind: 'info', text: 'Switched project' });
    vi.advanceTimersByTime(500);
    expect(dismiss).not.toHaveBeenCalled();

    policy.update(null);
    vi.advanceTimersByTime(2_500);
    expect(dismiss).not.toHaveBeenCalled();
    policy.dispose();
  });
});
