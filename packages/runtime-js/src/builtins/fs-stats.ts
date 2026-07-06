/**
 * The ONE `fs.Stats` shape every stat-shaped surface returns — statSync/
 * lstatSync/fstatSync (+ promises/callback twins) AND `fs.watchFile` listener
 * args. Extracted from fs.ts so fs-watch.ts can reuse it without an import
 * cycle: a bespoke `StatsLike` twin drifted (number `mtime`, no `mtimeMs`, no
 * `isSymbolicLink` — review 2026-07-06); the class boundary makes the next
 * field evolve everywhere at once.
 */
export class Stats {
  size: number;
  mtimeMs: number;
  private readonly _isFile: boolean;
  private readonly _isDirectory: boolean;
  constructor(vs: { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number }) {
    this.size = vs.size ?? 0;
    this.mtimeMs = vs.mtime ?? 0;
    this._isFile = vs.isFile;
    this._isDirectory = vs.isDirectory;
  }
  isFile(): boolean {
    return this._isFile;
  }
  isDirectory(): boolean {
    return this._isDirectory;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
  get mtime(): Date {
    return new Date(this.mtimeMs);
  }
}
