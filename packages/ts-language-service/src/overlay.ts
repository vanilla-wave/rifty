/**
 * In-memory overlay of open documents — the editor's unsaved buffers.
 *
 * The host consults the overlay before the VFS: an open document's text and
 * version come from here, so diagnostics reflect the editor buffer, not the
 * last write to disk. `invalidate` bumps a version without holding text, the
 * signal the host uses to make TS drop a cached file after an external VFS
 * write.
 *
 * Versions are monotonic per path (string, as `getScriptVersion` returns) so
 * any change — open, update, or invalidate — is strictly newer than the last.
 */

export interface DocumentEntry {
  readonly version: string;
  readonly text: string;
}

export interface DocumentOverlay {
  open(path: string, text: string): void;
  update(path: string, text: string): void;
  close(path: string): void;
  get(path: string): DocumentEntry | undefined;
  /**
   * Bump `path`'s version without recording text — forces TS to re-read the
   * file (e.g. after an external VFS write to a non-open file). Returns the new
   * version so a host can fold it into its own version string.
   */
  invalidate(path: string): string;
  /** Current version string for `path` (open text version or last invalidate). */
  versionOf(path: string): string | undefined;
}

export function createDocumentOverlay(): DocumentOverlay {
  // Open buffers (text + version). `close` removes from here.
  const open = new Map<string, DocumentEntry>();
  // Monotonic counter per path, persists across close so versions never reuse.
  const versions = new Map<string, number>();

  const bump = (path: string): string => {
    const next = (versions.get(path) ?? 0) + 1;
    versions.set(path, next);
    return String(next);
  };

  return {
    open(path, text) {
      open.set(path, { version: bump(path), text });
    },
    update(path, text) {
      open.set(path, { version: bump(path), text });
    },
    close(path) {
      open.delete(path);
    },
    get(path) {
      return open.get(path);
    },
    invalidate(path) {
      const version = bump(path);
      const entry = open.get(path);
      // Keep an open buffer's text; only its version moves.
      if (entry) open.set(path, { version, text: entry.text });
      return version;
    },
    versionOf(path) {
      const entry = open.get(path);
      if (entry) return entry.version;
      const n = versions.get(path);
      return n === undefined ? undefined : String(n);
    },
  };
}
