/**
 * Pure resolver for a `node <file>` argument (ADR-0155). Absolutizes the arg
 * against the shell cwd — it does NOT check existence: a missing entry flows on
 * into `runNodeEntry` → the module loader, which emits real Node's
 * `Error: Cannot find module '<abs>' … { code:'MODULE_NOT_FOUND', requireStack: [] }`
 * (backlog/runtime-js/node-entry-miss-node-shape). The only `ok:false` here is the
 * empty-arg usage error — never a silent stub.
 *
 * `@riftydev/vfs` exports no `resolve`; this mirrors the shell's own
 * `resolve(cwd, p)` (commands/_shared.ts) via the public path helpers:
 * `normalizePath(isAbsolute(p) ? p : joinPath(cwd, p))`.
 */
import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';

export type ResolveResult = { ok: true; path: string } | { ok: false; message: string };

/** Resolve (absolutize) a `node <file>` arg against cwd. No existence check. */
export function resolveNodeEntry(cwd: string, arg: string | undefined): ResolveResult {
  if (arg === undefined || arg === '') {
    return { ok: false, message: 'node: missing entry file\nUsage: node <file> [args]\n' };
  }
  return { ok: true, path: normalizePath(isAbsolute(arg) ? arg : joinPath(cwd, arg)) };
}
