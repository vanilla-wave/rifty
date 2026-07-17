import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDelayedCatalogDelete } from './playground-delete-policy.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('Playground delayed catalog delete policy', () => {
  it('does not call the owner catalog during the Undo window and cancels it on Undo', async () => {
    vi.useFakeTimers();
    const deleteProject = vi.fn(async () => {});
    const policy = createDelayedCatalogDelete({
      delayMs: 3_200,
      deleteProject,
      onCommitted: vi.fn(),
      onFailed: vi.fn(),
    });

    policy.schedule('project-a');
    await vi.advanceTimersByTimeAsync(3_199);
    expect(deleteProject).not.toHaveBeenCalled();
    expect(policy.undo()).toBe('project-a');
    await vi.advanceTimersByTimeAsync(1);
    expect(deleteProject).not.toHaveBeenCalled();
    expect(policy.pending()).toBeNull();
  });

  it('commits exactly once after the window and reports owner failure without a false commit', async () => {
    vi.useFakeTimers();
    const failure = new Error('quota');
    const deleteProject = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(failure);
    const onCommitted = vi.fn();
    const onFailed = vi.fn();
    const policy = createDelayedCatalogDelete({
      delayMs: 3_200,
      deleteProject,
      onCommitted,
      onFailed,
    });

    policy.schedule('project-a');
    await vi.advanceTimersByTimeAsync(3_200);
    expect(deleteProject).toHaveBeenNthCalledWith(1, 'project-a');
    expect(onCommitted).toHaveBeenCalledWith('project-a');

    policy.schedule('project-b');
    await vi.advanceTimersByTimeAsync(3_200);
    expect(deleteProject).toHaveBeenNthCalledWith(2, 'project-b');
    expect(onFailed).toHaveBeenCalledWith('project-b', failure);
    expect(policy.pending()).toBeNull();
  });
});
