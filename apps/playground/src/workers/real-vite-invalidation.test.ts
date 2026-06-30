import { describe, expect, it, vi } from 'vitest';
import {
  type ViteDevServerWithModuleGraph,
  invalidateViteModule,
} from './real-vite-invalidation.ts';

describe('invalidateViteModule', () => {
  it('invalidates the module graph before emitting a Vite watcher change', () => {
    const emit = vi.fn();
    const onFileChange = vi.fn();
    const invalidateAll = vi.fn();
    const moduleGraph = {
      onFileChange,
      invalidateAll,
    };

    invalidateViteModule(
      {
        watcher: { emit },
        moduleGraph,
      },
      '/workspace/src/main.js',
    );

    expect(emit).toHaveBeenCalledWith('change', '/workspace/src/main.js');
    expect(onFileChange).toHaveBeenCalledWith('/workspace/src/main.js');
    expect(invalidateAll).toHaveBeenCalled();
    expect(onFileChange.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? 0,
    );
    expect(invalidateAll.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('falls back to moduleGraph.onFileChange when the watcher is not emitter-shaped', () => {
    const onFileChange = vi.fn();
    const moduleGraph = {
      onFileChange,
    };

    invalidateViteModule(
      {
        moduleGraph,
      },
      '/workspace/src/main.js',
    );

    expect(onFileChange).toHaveBeenCalledWith('/workspace/src/main.js');
  });

  it('invalidates the whole graph when Vite exposes the broad invalidation hook', () => {
    const invalidateAll = vi.fn();
    const moduleGraph = { invalidateAll } as unknown as ViteDevServerWithModuleGraph['moduleGraph'];

    invalidateViteModule(
      {
        moduleGraph,
      },
      '/workspace/src/main.js',
    );

    expect(invalidateAll).toHaveBeenCalled();
  });

  it('aborts pending transforms before invalidating and emitting the watcher change', () => {
    const abortFirst = vi.fn();
    const abortSecond = vi.fn();
    const invalidateAll = vi.fn();
    const emit = vi.fn();
    const pendingRequests = new Map([
      ['/src/main.ts', { abort: abortFirst }],
      ['/src/model.ts', { abort: abortSecond }],
    ]);

    invalidateViteModule(
      {
        _pendingRequests: pendingRequests,
        moduleGraph: { invalidateAll },
        watcher: { emit },
      },
      '/workspace/src/main.ts',
    );

    expect(abortFirst).toHaveBeenCalled();
    expect(abortSecond).toHaveBeenCalled();
    expect(pendingRequests.size).toBe(0);
    expect(abortFirst.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateAll.mock.invocationCallOrder[0] ?? 0,
    );
    expect(abortSecond.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateAll.mock.invocationCallOrder[0] ?? 0,
    );
    expect(invalidateAll.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
