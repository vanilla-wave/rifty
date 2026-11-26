/** `dist/codec.js`: rifty's MemoryFs and the snapshot codec, bundled (`src/codec.ts`). */
export interface Fs {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  readdirSync(path: string): readonly { name: string; isFile: boolean; isDirectory: boolean }[];
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  statSync(path: string): {
    isFile: boolean;
    isDirectory: boolean;
    size?: number;
    mtime?: number;
    atime?: number;
    metadata?: { ctime: number; birthtime: number };
  };
  restoreStatSync(path: string, stat: EntryTimes): void;
}
export interface EntryTimes {
  readonly mtimeMs: number;
  readonly atimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
}
export interface Codec {
  MemoryFsSync: new () => Fs;
  GUEST_DIRS: readonly string[];
  snapshotFs(fs: Fs, options: SnapshotOptions): Uint8Array;
  /** The least `maxBytes` the snapshot of `fs` fits (ADR-0567 §7). */
  snapshotBudget(fs: Fs): number;
  restoreFs(fs: Fs, bytes: Uint8Array, options: SnapshotOptions): void;
  readDepSnapshotTar(bytes: Uint8Array): readonly TarEntry[];
  readDepSnapshotManifest(entries: readonly TarEntry[]): Record<string, unknown>;
}
/** An entry of a `produceDependencySnapshot` tar (`@riftydev/npm-client` envelope reader). */
export interface TarEntry {
  readonly path: string;
  readonly directory: boolean;
  readonly bytes: Uint8Array;
  readonly mtimeMs: number;
}
export interface SnapshotOptions {
  readonly template: null;
  readonly maxBytes: number;
}
// `src/` in the workspace and `dist/` when packed are both one level under the package root.
let codec: Promise<Codec> | undefined;
export function loadCodec(): Promise<Codec> {
  codec ??= import(new URL('../dist/codec.js', import.meta.url).href) as Promise<Codec>;
  return codec;
}

/** The codec's budget for an empty sandbox (`GUEST_DIRS`): no cap may be lower. */
let emptyCost: number | undefined;
export function emptySandboxCost(c: Codec): number {
  if (emptyCost !== undefined) return emptyCost;
  const fs = new c.MemoryFsSync();
  for (const dir of c.GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  emptyCost = c.snapshotBudget(fs);
  return emptyCost;
}
