/**
 * Run a VFS Node entry through the rifty module loader (ADR-0137).
 *
 * Shared by the shell `.bin` executor (a `node_modules/.bin/<name>` launcher
 * shim) and `child_process` (`node <script>`): both need a Node entry executed
 * with shebang stripping AND relative `import`/`require` resolved against the
 * VFS — which only `createModuleLoader` does. The kernel's raw `kind:'source'`
 * path (`new AsyncFunction`) does neither, so it cannot run either.
 *
 * `.bin` launchers are NOT executed as text: a launcher is
 * `#!/usr/bin/env node` + `import('../<pkg>/<bin>')`, and dynamic `import()`
 * inside a CJS module is not routed to the loader. Instead we read the shim,
 * pull its launcher target, and import THAT through the loader (resolved
 * against the shim's own path) — running the real bin (CJS or ESM).
 *
 * Pure module-loader work; the caller runs it inside the Worker realm where the
 * VFS sync mirror and the Node `process` shim are already installed.
 */

import { NotImplementedError } from '@riftydev/io';
import type { FsSync } from '@riftydev/vfs';
import { type ModuleLoader, createModuleLoader } from '../module-loader/loader.ts';

const utf8 = new TextDecoder();

/**
 * The launcher target of a linker `.bin` shim — the relative specifier in its
 * `import('…')`, or `null` when `source` is not a recognizable launcher.
 */
export function parseBinLauncherTarget(source: string): string | null {
  const m = source.match(/import\(\s*['"]([^'"]+)['"]\s*\)/);
  return m ? (m[1] as string) : null;
}

export interface RunNodeEntryOptions {
  readonly vfs: FsSync;
  /** Absolute VFS path: a `.bin` launcher shim when `bin`, else a Node script. */
  readonly entryPath: string;
  readonly cwd: string;
  /** `entryPath` is a `node_modules/.bin/<name>` launcher — run its target. */
  readonly bin?: boolean;
  /** Loader factory seam (tests inject; production uses the real loader). */
  readonly createLoader?: (vfs: FsSync, opts: { cwd: string }) => ModuleLoader;
}

/** Import the resolved Node entry (or a `.bin` launcher's target) via the loader. */
export async function runNodeEntry(opts: RunNodeEntryOptions): Promise<void> {
  const loader = (opts.createLoader ?? createModuleLoader)(opts.vfs, { cwd: opts.cwd });
  if (opts.bin) {
    const shim = utf8.decode(opts.vfs.readFileBytesSync(opts.entryPath));
    const target = parseBinLauncherTarget(shim);
    if (target === null) {
      // Loud, never a silent no-op: the shell resolved a shim we can't launch.
      throw new NotImplementedError(
        'runtime-js.bin-launcher',
        `unrecognized node_modules/.bin launcher shim: ${opts.entryPath}`,
      );
    }
    // Resolve the launcher target against the shim's own path, then run it.
    await loader.import(target, opts.entryPath);
    return;
  }
  await loader.import(opts.entryPath, opts.entryPath);
}
