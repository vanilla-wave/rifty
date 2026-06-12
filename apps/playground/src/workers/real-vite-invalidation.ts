import { normalizePath } from '@riftydev/vfs';

export interface ViteModuleGraph {
  onFileChange?(file: string): void;
}

export interface ViteDevServerWithModuleGraph {
  moduleGraph?: ViteModuleGraph;
}

export function invalidateViteModule(server: ViteDevServerWithModuleGraph, file: string): void {
  server.moduleGraph?.onFileChange?.(normalizePath(file));
}
