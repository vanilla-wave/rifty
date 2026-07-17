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
import { ModuleLoadError } from '../module-loader/errors.ts';
import { type ModuleLoader, createModuleLoader } from '../module-loader/loader.ts';

const utf8 = new TextDecoder();

/**
 * Real-Node printed form of an uncaught CJS-loader `MODULE_NOT_FOUND`: the
 * `Error: <message>` line — the message already carries Node's `Require stack:`
 * block when the require-stack is non-empty — followed by the inspected tail of
 * the error's own props, `{ code, requireStack }`. ALL stack frames are dropped:
 * the `node:internal/…` loader frames have no in-browser equivalent (and are
 * version-specific noise tooling does not match on), and rifty does not
 * synthesize the Node-style user call-site frame either — so a nested miss omits
 * the `at <file>` line Node would interleave (an entry miss has no user frame
 * anyway). The `Node.js vX` trailer is likewise omitted. `requireStack` uses
 * Node's INLINE array form (`[]` / `[ 'a', 'b' ]`) — faithful for the common
 * short-path case; util.inspect's multi-line wrap for long paths + single-quote
 * escaping are not reproduced. See docs/public/compat/process.md.
 */
function formatNodeModuleNotFound(err: ModuleLoadError): string {
  const stack = err.requireStack ?? [];
  const inspected = stack.length === 0 ? '[]' : `[ ${stack.map((p) => `'${p}'`).join(', ')} ]`;
  return `Error: ${err.message}\n{\n  code: '${err.code}',\n  requireStack: ${inspected}\n}`;
}

/**
 * Surface an uncaught `MODULE_NOT_FOUND` as Node's CJS-loader Error. The kernel
 * worker-entry writes `err.stack` to the child stderr, so set it to the printed
 * form above (plain `Error` name, no rifty `ModuleLoadError` name / frames).
 * `code`/`requireStack` ride along for error-matching tooling.
 *
 * Gated on `requireStack` being present: the resolver sets it ONLY on the
 * CJS-loader-shaped misses (a missing entry — incl. `.mjs`, which Node runs
 * through the CJS loader — and a nested `require()`), where this CJS printed
 * form is faithful. A nested ESM `import()` miss (Node's `ERR_MODULE_NOT_FOUND`,
 * a shape rifty does not emit yet) carries NO `requireStack`, so it is left as
 * the honest rifty `ModuleLoadError` rather than masquerade as the CJS form.
 * Every other error propagates unchanged (the generic-throw path stays
 * `err.stack`). TODO(backlog: runtime-js/esm-import-miss-err-module-not-found)
 */
function asNodePrintedError(err: unknown): unknown {
  if (
    err instanceof ModuleLoadError &&
    err.code === 'MODULE_NOT_FOUND' &&
    err.requireStack !== undefined
  ) {
    const out = new Error(err.message) as Error & {
      code?: string;
      requireStack?: readonly string[];
    };
    out.stack = formatNodeModuleNotFound(err);
    out.code = err.code;
    out.requireStack = err.requireStack;
    return out;
  }
  return err;
}

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

function exportedPromise(ns: Record<string, unknown>): PromiseLike<unknown> | null {
  const candidates = [ns.__promise];
  const d = ns.default;
  if (d && (typeof d === 'object' || typeof d === 'function')) {
    candidates.push((d as Record<string, unknown>).__promise);
  }
  for (const candidate of candidates) {
    if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) continue;
    const then = (candidate as { then?: unknown }).then;
    if (typeof then === 'function') return candidate as PromiseLike<unknown>;
  }
  return null;
}

/** Import the resolved Node entry (or a `.bin` launcher's target) via the loader. */
export async function runNodeEntry(opts: RunNodeEntryOptions): Promise<void> {
  const loader = (opts.createLoader ?? createModuleLoader)(opts.vfs, { cwd: opts.cwd });
  try {
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
      const ns = await loader.import(target, opts.entryPath);
      const pending = exportedPromise(ns);
      if (pending) await pending;
      return;
    }
    await loader.import(opts.entryPath, opts.entryPath);
  } catch (err) {
    // A missing entry (`node ./nope.js`) or an uncaught nested-require miss
    // surfaces real Node's `Error: Cannot find module … { code, requireStack }`
    // on the child stderr instead of rifty's ModuleLoadError name + frames
    // (backlog/runtime-js/node-entry-miss-node-shape). All other throws are
    // re-raised unchanged.
    throw asNodePrintedError(err);
  }
}
