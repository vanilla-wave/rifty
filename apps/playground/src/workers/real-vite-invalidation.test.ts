import { describe, expect, it, vi } from 'vitest';
import {
  type ViteDevServerWithModuleGraph,
  invalidateViteModule,
} from './real-vite-invalidation.ts';

describe('invalidateViteModule', () => {
  it('emits a Vite watcher change so Vite builds native HMR payloads', () => {
    const emit = vi.fn();
    const onFileChange = vi.fn();
    const moduleGraph = {
      onFileChange,
    };

    invalidateViteModule(
      {
        watcher: { emit },
        moduleGraph,
      },
      '/workspace/src/main.js',
    );

    expect(emit).toHaveBeenCalledWith('change', '/workspace/src/main.js');
    expect(onFileChange).not.toHaveBeenCalled();
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
