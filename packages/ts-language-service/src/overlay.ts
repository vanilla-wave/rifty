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
  /** Paths of all currently-open buffers (for `getScriptFileNames`). */
  openPaths(): readonly string[];
  /**
   * Bump `path`'s invalidation counter — forces TS to re-read the file from the
   * VFS (e.g. after an external write to a non-open file). Returns the new
   * counter so a host can fold it into its own version string.
   */
  invalidate(path: string): number;
  /**
   * Version string for an OPEN buffer (open/update bump it). `undefined` when no
   * buffer is open — the host then derives the version from the VFS + the
   * {@link invalidationOf} counter, so closing reverts the version (and content)
   * to disk.
   */
  versionOf(path: string): string | undefined;
  /** Monotonic external-invalidation counter for `path` (0 if never bumped). */
  invalidationOf(path: string): number;
}

export function createDocumentOverlay(): DocumentOverlay {
  // Open buffers (text + version). `close` removes from here.
  const open = new Map<string, DocumentEntry>();
  // Per-path open-edit counter; monotonic across re-open so a version is never
  // reused for different content.
  const editSeq = new Map<string, number>();
  // Per-path external-invalidation counter (independent of open buffers).
  const invalidations = new Map<string, number>();

  // Open version carries the invalidation counter too, so an external write to
  // an open file (rare) still moves the version.
  const openVersion = (path: string): string =>
    `o${editSeq.get(path) ?? 0}:${invalidations.get(path) ?? 0}`;

  const setBuffer = (path: string, text: string): void => {
    editSeq.set(path, (editSeq.get(path) ?? 0) + 1);
    open.set(path, { version: openVersion(path), text });
  };

  return {
    open(path, text) {
      setBuffer(path, text);
    },
    update(path, text) {
      setBuffer(path, text);
    },
    close(path) {
      // Drop the buffer; counters persist so versions stay monotonic.
      open.delete(path);
    },
    get(path) {
      return open.get(path);
    },
    openPaths() {
      return [...open.keys()];
    },
    invalidate(path) {
      const next = (invalidations.get(path) ?? 0) + 1;
      invalidations.set(path, next);
      // An open buffer keeps its text; its version moves to reflect the bump.
      const entry = open.get(path);
      if (entry) open.set(path, { version: openVersion(path), text: entry.text });
      return next;
    },
    versionOf(path) {
      return open.get(path)?.version;
    },
    invalidationOf(path) {
      return invalidations.get(path) ?? 0;
    },
  };
}
