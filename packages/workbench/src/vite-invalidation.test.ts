import { describe, expect, it, vi } from 'vitest';
import { type ViteDevServerWithModuleGraph, invalidateViteModule } from './vite-invalidation.ts';

describe('invalidateViteModule', () => {
  it('uses Vite moduleGraph.onFileChange for file-level invalidation', () => {
    const onFileChange = vi.fn();
    const getModuleById = vi.fn();
    const invalidateAll = vi.fn();
    const moduleGraph = {
      onFileChange,
      getModuleById,
      invalidateAll,
    };

    invalidateViteModule(
      {
        moduleGraph,
      },
      '/workspace/src/main.js',
    );

    expect(onFileChange).toHaveBeenCalledWith('/workspace/src/main.js');
    expect(getModuleById).not.toHaveBeenCalled();
    expect(invalidateAll).not.toHaveBeenCalled();
  });

  it('does not fall back to invalidating the whole graph', () => {
    const invalidateAll = vi.fn();
    const moduleGraph = { invalidateAll } as unknown as ViteDevServerWithModuleGraph['moduleGraph'];

    invalidateViteModule(
      {
        moduleGraph,
      },
      '/workspace/src/main.js',
    );

    expect(invalidateAll).not.toHaveBeenCalled();
  });
});
