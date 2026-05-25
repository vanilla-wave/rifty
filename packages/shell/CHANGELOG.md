# @rifty/shell — Changelog

## [Unreleased]

### Added

- Initial package (M10): tokenizer, `Shell` dispatcher with built-ins
  (`pwd`, `cd`, `ls`, `cat`, `echo`, `mkdir`, `rm`, `env`, `touch`),
  `>` / `>>` redirection, env-assignment prefix, `registerCommand` for
  external commands. 13 unit tests.
- Tokenizer: POSIX-style quote semantics — single quotes are literal, double
  quotes expand `$VAR` / `${VAR}` and honour `\$` / `\"` / `\\` / `` \` ``
  escapes. Unquoted `$VAR` also expands. Unknown variables expand to the
  empty string (POSIX). Unsupported expansion forms (`${VAR:-default}` etc.)
  throw rather than silently dropping characters.
- `touch` on an existing file now bumps its mtime through `FsSync.utimes`
  (ADR-0029); works on every backend, including OPFS. Dropped the
  `@rifty/vfs/internal` backend-sniffing import and the
  `NotImplementedError('shell.touch.utimes')` escape hatch.

### Changed

- `Shell.run` passes the shell env to the tokenizer so `$VAR` expansion
  works in command arguments.

### Loud `NotImplementedError`s (replaced silent drops)

- `<` input redirect now throws `NotImplementedError('shell.input-redirect')`
  with the M12 work-item hint, instead of being silently dropped by the
  dispatch step.
- `|` (pipe) operator now tokenises as its own `'|'` token (previously it
  could get buried inside an argument, e.g. `cat f | grep x` silently
  losing the pipe). The dispatcher throws
  `NotImplementedError('shell.pipe')` when a pipe token is encountered,
  matching the `<` pattern.

### Fixed

- Redirect write failures (`> path`, `>> path`) no longer silently dump the
  buffered output onto stdout. When the underlying `writeFileSync` throws,
  the shell now: clears stdout (the data was intended for a file, not the
  console), populates stderr with a `redirect write failed: <path>: <msg>
  [EREDIRECT]` line, and returns a non-zero exit code so callers can detect
  the failure unambiguously.

### Internal

- Removed an unused public `CommandContext` / `ShellCommand` type re-export
  from `builtins.ts`. The single canonical source of these types is
  `./types.ts`; the public package surface (`./index.ts`) already exports
  them from there.

### Dependencies

- Added `@rifty/io` (workspace) for `NotImplementedError`.
