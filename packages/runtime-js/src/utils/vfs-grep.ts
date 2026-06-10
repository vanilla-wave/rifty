/**
 * Pure-JS VFS grep helper for terminal/search flows. It reads bytes and matches
 * in-realm with ZERO process spawn, unlike ripgrep-the-binary.
 *
 * Pure-JS rather than ripgrep-WASM keeps the helper dependency-free and
 * trivially reversible. A ripgrep-WASM substitute would vendor a new binary and
 * should be justified by measured terminal/search needs.
 *
 * PRIVATE helper: not re-exported via `src/index.ts`, registers no builtin,
 * adds no resolver intercept; imports only `builtins/fs.ts` and `@riftydev/vfs`
 * (layer-legal, no reverse import).
 */
import { joinPath } from '@riftydev/vfs';
import { type Dirent, readFileSync, readdirSync } from '../builtins/fs.ts';

/** A single line match. `line`/`column` are 1-based (ripgrep/Node grep convention). */
export interface VfsGrepMatch {
  /** Absolute VFS path of the matching file. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the first matching character. */
  column: number;
  /** Full matching line, no trailing newline. */
  text: string;
}

/** Options for {@link vfsGrep}. */
export interface VfsGrepOptions {
  /**
   * Restrict to files whose path ends with this suffix (e.g. `'.ts'` or
   * `'*.ts'`). Suffix match only — NOT full glob (a glob dependency would be
   * IRREVERSIBLE; out of scope for the marker).
   */
  include?: string;
  /** Stop after this many matches (bounds the walk). */
  maxResults?: number;
  /** Match case-insensitively. */
  ignoreCase?: boolean;
}

function toRegExp(pattern: string | RegExp, ignoreCase: boolean): RegExp {
  if (pattern instanceof RegExp) {
    // Strip 'g'/'y': with 'g', `String.prototype.match` returns an array
    // WITHOUT `.index`, silently dropping every match. Other flags preserved.
    let flags = pattern.flags.replace(/[gy]/g, '');
    if (ignoreCase && !flags.includes('i')) flags += 'i';
    return new RegExp(pattern.source, flags);
  }
  // Escape so the literal string matches verbatim, not as a regex.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, ignoreCase ? 'i' : '');
}

function toSuffix(include: string | undefined): string | undefined {
  if (include === undefined) return undefined;
  return include.startsWith('*') ? include.slice(1) : include;
}

/**
 * Recursively search every line of every file under `root` for `pattern`.
 *
 * `line`/`column` are 1-based to match ripgrep/Node grep output. The underlying
 * `node:fs` ENOENT propagates when `root` does not exist — not swallowed.
 *
 * @param pattern Literal string (matched verbatim) or a `RegExp`.
 * @param root Absolute VFS directory to search.
 * @param opts `include` suffix filter, `maxResults` cap, `ignoreCase`.
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
