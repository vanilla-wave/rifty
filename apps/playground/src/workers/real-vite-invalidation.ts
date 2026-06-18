import { normalizePath } from '@riftydev/vfs';

export interface ViteModuleGraph {
  onFileChange?(file: string): void;
}

export interface ViteWatcherEmitter {
  emit?(event: 'change', file: string): unknown;
}

export interface ViteDevServerWithModuleGraph {
  watcher?: ViteWatcherEmitter;
  moduleGraph?: ViteModuleGraph;
}

// Load-bearing, not an optimization: editor writes land in the worker VFS
// without firing Vite's watcher. Prefer the watcher event so Vite runs its
// native handleHMRUpdate path; fallback only invalidates stale transforms.
export function invalidateViteModule(server: ViteDevServerWithModuleGraph, file: string): void {
  const normalized = normalizePath(file);
  if (typeof server.watcher?.emit === 'function') {
    server.watcher.emit('change', normalized);
    return;
  }
  server.moduleGraph?.onFileChange?.(normalized);
}
