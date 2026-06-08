/**
 * Zero-dependency SGR (Select Graphic Rendition) color helper for `ls`.
 *
 * Not picocolors: its browser build emits NO escape codes, so it is actively
 * wrong here. We need real ESC[..m bytes regardless of host.
 *
 * Minimal LS_COLORS subset (Q-2026-06-06-402): only directories are colored.
 * VFS has no exec-bit and no symlinks (ADR-0050), so the GNU classes that key
 * off those (ex / ln / etc.) can never apply — coloring them would be a lie.
 */

const ESC = String.fromCharCode(27);

/** Wrap `s` in an SGR sequence: ESC[`code`m … ESC[0m (the trailing reset is load-bearing). */
export function sgr(code: string, s: string): string {
  return `${ESC}[${code}m${s}${ESC}[0m`;
}

/**
 * Color a directory-entry name for `ls`.
 * @param enabled false on the `--color=never` / non-TTY path — returns `name`
 *   verbatim so e.g. `ls --color=auto > f` writes no SGR into the redirected file.
 */
export function colorize(
  name: string,
  dirent: { isDirectory: boolean; isFile: boolean },
  enabled: boolean,
): string {
  if (!enabled) return name;
  return dirent.isDirectory ? sgr('1;34', name) : name; // bold blue dirs only
}
