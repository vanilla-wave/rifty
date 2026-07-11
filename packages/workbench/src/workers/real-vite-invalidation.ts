import { normalizePath } from '@riftydev/vfs';

export interface ViteModuleGraph {
  onFileChange?(file: string): void;
  invalidateAll?(): void;
}

export interface ViteWatcherEmitter {
  emit?(event: 'change', file: string): unknown;
}

export interface VitePendingTransformRequest {
  abort?(): void;
}

export interface ViteDevServerWithModuleGraph {
  watcher?: ViteWatcherEmitter;
  moduleGraph?: ViteModuleGraph;
  _pendingRequests?: Map<string, VitePendingTransformRequest>;
}

function abortPendingTransforms(server: ViteDevServerWithModuleGraph): void {
  const pendingRequests = server._pendingRequests;
  if (!pendingRequests) {
    return;
  }

  for (const pendingRequest of pendingRequests.values()) {
    pendingRequest.abort?.();
  }
  pendingRequests.clear();
}

// Load-bearing, not an optimization: editor writes land in the worker VFS
// without firing Vite's watcher. Invalidate synchronously so the next clean
// module fetch sees fresh bytes, then emit the watcher event for native HMR.
export function invalidateViteModule(server: ViteDevServerWithModuleGraph, file: string): void {
  const normalized = normalizePath(file);
  abortPendingTransforms(server);
  server.moduleGraph?.onFileChange?.(normalized);
  server.moduleGraph?.invalidateAll?.();
  if (typeof server.watcher?.emit === 'function') {
    server.watcher.emit('change', normalized);
  }
}
