/**
 * `@rifty/vfs/internal` — internal entry point for symbols that exist to
 * wire the runtime together but are NOT part of `@rifty/vfs`'s stable
 * public surface.
 *
 * Imports from this entry point are only allowed from inside the rifty
 * workspace (no consumer outside the monorepo should rely on these). The
 * goal is to keep the public `@rifty/vfs` API ({@link Vfs},
 * {@link OpfsVfs}, {@link MemoryVfs}, path helpers, error class) small and
 * stable while still letting other packages (runtime-js, shell, etc.)
 * reach the swap-in registry helpers.
 *
 * Promoting something from `internal` to the public surface is an
 * IRREVERSIBLE decision per CLAUDE.md (touches the public API between
 * packages). Demoting from public to `internal` is also IRREVERSIBLE
 * because consumers may import the name.
 */

export {
  setSyncMirror,
  setAsyncVfs,
  resetSyncMirror,
  installMemoryFs,
  installOpfsFs,
  createMemoryFs,
  MemoryFsSync,
} from '../sync-mirror.ts';
export { MemoryBackend } from '../memory-backend.ts';
