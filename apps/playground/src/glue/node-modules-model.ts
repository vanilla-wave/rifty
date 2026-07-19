/** App presentation limit for opening large dependency files in the editor. */
export const NODE_MODULES_MAX_CONTENT_BYTES = 128 * 1024;

export interface NodeModulesDirEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir';
  readonly size: number;
}

export interface NodeModulesBridge {
  readdir(path: string): Promise<readonly NodeModulesDirEntry[]>;
  readFile(path: string): Promise<{ readonly size: number; readonly content: Uint8Array | null }>;
  dispose(): void;
}
