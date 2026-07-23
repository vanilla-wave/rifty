/** One `node_modules` directory entry exposed to the App explorer. */
export interface NodeModulesDirEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir';
  readonly size: number;
}

/** Read-only package tree view supplied by the active Workbench session. */
export interface NodeModulesBridge {
  readdir(path: string): Promise<readonly NodeModulesDirEntry[]>;
  readFile(path: string): Promise<{ readonly size: number; readonly content: Uint8Array | null }>;
  dispose(): void;
}

/** App-side safety limit for opening dependency files in Monaco. */
export const NODE_MODULES_MAX_CONTENT_BYTES = 128 * 1024;
