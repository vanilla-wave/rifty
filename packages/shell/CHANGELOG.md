# @riftydev/shell — Changelog

## [Unreleased]

### Added

- `Shell.run(line, options?)` now accepts an optional `onChunk(chunk, stream)`
  callback that fires synchronously for every stdout/stderr write a command
  produces. Lets the terminal show `npm install` progress bars and
  `vite dev` request logs in real time instead of receiving the full blob
  after `await`. `RunResult.stdout` / `RunResult.stderr` still carry the
  captured payload — the option is additive.
- `&&` / `||` / `;` compound-chain parsing: `cd app && npm install` now
  runs both segments with POSIX joiner semantics (`&&` only on success,
  `||` only on failure, `;` always). Quoted joiners stay literal
  (`echo 'a && b'` is one argument). Tokenizer emits the new joiners as
  their own tokens.
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
  `@riftydev/vfs/internal` backend-sniffing import and the
  `NotImplementedError('shell.touch.utimes')` escape hatch.

### Changed

- `Shell.run` passes the shell env to the tokenizer so `$VAR` expansion
  works in command arguments.

### Loud `NotImplementedError`s (replaced silent drops)

- Bare `&` (background execution) now throws
  `NotImplementedError('shell.background')` instead of silently merging into
  the previous argument. Use foreground execution.

(legacy entries — preserved for context)

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

- Added `@riftydev/io` (workspace) for `NotImplementedError`.
