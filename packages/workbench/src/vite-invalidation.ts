import { normalizePath } from '@riftydev/vfs';

export interface ViteModuleGraph {
  onFileChange?(file: string): void;
}

export interface ViteDevServerWithModuleGraph {
  moduleGraph?: ViteModuleGraph;
}

// Load-bearing, not an optimization: editor writes land in the worker VFS
// without firing Vite's watcher, so without this onFileChange call the dev
// server serves stale transforms after the HMR reload.
export function invalidateViteModule(server: ViteDevServerWithModuleGraph, file: string): void {
  server.moduleGraph?.onFileChange?.(normalizePath(file));
}
