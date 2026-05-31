/**
 * Pure-JS VFS grep marker tool — the ONE read-only tool that marks the FEASIBLE
 * side of the no-tool-execution (process-spawn) ceiling for the opencode server
 * facade (F09 D1).
 *
 * It walks the VFS recursively via the EXISTING `node:fs` builtin
 * (`readdirSync` with file types / `readFileSync` over `syncMirror()`) and
 * matches lines with the JS RegExp engine. It runs entirely IN-REALM with ZERO
 * process spawn — which is exactly why it sits on the feasible side: it does
 * what opencode's read/grep tools do (read bytes + match) WITHOUT the
 * process-spawn that ripgrep-the-binary needs.
 *
 * Deliberately pure-JS rather than ripgrep-WASM: that keeps the marker
 * dependency-free and trivially reversible (deleting this file + its test). A
 * ripgrep-WASM substitute would vendor a new binary and is therefore
 * IRREVERSIBLE — explicitly DEFERRED behind ADR ratification.
 *
 * This is a PRIVATE helper: it is NOT re-exported via `src/index.ts`, registers
 * NO new builtin, and adds NO resolver intercept. It only imports its own
 * runtime-js `builtins/fs.ts` and `@rifty/vfs` (layer-legal, no reverse import).
 *
 * TODO(ADR): Q-2026-05-30-061 — pure-JS marker tool chosen over ripgrep-WASM;
 * ripgrep-WASM / isomorphic-git deferred behind explicit human ratification.
 */
import { joinPath } from '@rifty/vfs';
import { type Dirent, readFileSync, readdirSync } from '../builtins/fs.ts';

/** A single line match. `line` and `column` are 1-based (ripgrep/Node grep convention). */
export interface VfsGrepMatch {
  /** Absolute VFS path of the file containing the match. */
  path: string;
  /** 1-based line number of the match within the file. */
  line: number;
  /** 1-based column of the first matching character on that line. */
  column: number;
  /** The full text of the matching line (no trailing newline). */
  text: string;
}

/** Options for {@link vfsGrep}. */
export interface VfsGrepOptions {
  /**
   * Restrict the scan to files whose path ends with this suffix (e.g. `'.ts'`
   * or `'*.ts'`). Minimal suffix/extension match — NOT full glob (pulling a
   * glob dependency would be IRREVERSIBLE; out of scope for the marker).
   */
  include?: string;
  /** Stop after this many matches (bounds the walk). */
  maxResults?: number;
  /** Match case-insensitively. */
  ignoreCase?: boolean;
}

/** Compile the user pattern into a RegExp, honouring `ignoreCase`. */
function toRegExp(pattern: string | RegExp, ignoreCase: boolean): RegExp {
  if (pattern instanceof RegExp) {
    // Strip 'g'/'y': per-line first-match semantics never use them, and with
    // 'g' `String.prototype.match` returns an array WITHOUT `.index`, which
    // would silently drop every match. Other flags (m/s/u/d/i) are preserved.
    let flags = pattern.flags.replace(/[gy]/g, '');
    if (ignoreCase && !flags.includes('i')) flags += 'i';
    return new RegExp(pattern.source, flags);
  }
  // Escape the literal string so it matches verbatim, not as a regex.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, ignoreCase ? 'i' : '');
}

/** Normalise an `include` filter (`'*.ts'` or `'.ts'`) into a path suffix. */
function toSuffix(include: string | undefined): string | undefined {
  if (include === undefined) return undefined;
  return include.startsWith('*') ? include.slice(1) : include;
}

/**
 * Recursively search the lines of every file under `root` for `pattern`.
 *
 * Pure-JS, in-realm, zero process spawn. Walks via the existing `node:fs`
 * builtin (`readdirSync` with file types over `syncMirror()`) and matches each
 * line with the JS RegExp engine. `line`/`column` are 1-based to match
 * ripgrep/Node grep output, so the marker is faithful to what it substitutes.
 *
 * The underlying `node:fs` ENOENT propagates when `root` does not exist — it is
 * NOT swallowed (no silent stub).
 *
 * @param pattern Literal string (matched verbatim) or a `RegExp`.
 * @param root Absolute VFS directory to search.
 * @param opts Optional `include` suffix filter, `maxResults` cap, `ignoreCase`.
 * @returns Matches in walk order, capped at `maxResults` when given.
 */
export function vfsGrep(
  pattern: string | RegExp,
  root: string,
  opts: VfsGrepOptions = {},
): VfsGrepMatch[] {
  const re = toRegExp(pattern, opts.ignoreCase ?? false);
  const suffix = toSuffix(opts.include);
  const max = opts.maxResults;
  const matches: VfsGrepMatch[] = [];

  const walk = (dir: string): void => {
    if (max !== undefined && matches.length >= max) return;
    const entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
    for (const entry of entries) {
      if (max !== undefined && matches.length >= max) return;
      const full = joinPath(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (suffix !== undefined && !full.endsWith(suffix)) continue;
      scanFile(full);
    }
  };

  const scanFile = (path: string): void => {
    const text = readFileSync(path, 'utf8') as string;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (max !== undefined && matches.length >= max) return;
      const line = lines[i] ?? '';
      // Fresh search each line so `column` reflects this line, not lastIndex.
      const m = line.match(re);
      if (m && m.index !== undefined) {
        matches.push({ path, line: i + 1, column: m.index + 1, text: line });
      }
    }
  };

  walk(root);
  return matches;
}
