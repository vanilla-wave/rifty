# @riftydev/shell — Changelog

## [Unreleased]

### Added

- **ADR-0081 (file-arg coreutils):** new pure-JS builtins over `syncMirror()`, one
  file each under `src/commands/` + a `_shared.ts` (`resolve`/`enc`/`dec`):
  `cat -n/-b/-A/-E`, `head -n/-c` (incl. negative-N), `tail -n/-c` (incl. `+N`;
  `-f` throws), `wc -l/-w/-c/-m`, `cp [-r] [-n]` (over `copyFileSync`/`cpSync`),
  `mv [-n]` (over `renameSync`, mtime-preserving), `basename`/`dirname`/`realpath`
  (path-math; realpath is normalize+exists, no symlinks per ADR-0050), `seq -s/-w`,
  `true`/`false`, `printf` (`%s %d %x %o %c %%` + escapes, arg-recycling), and an
  upgraded `echo -n/-e/-E`. Every unimplemented flag throws
  `NotImplementedError('shell.<cmd>.<flag>')` (no silent stub); each defines its
  GNU-faithful exit code (load-bearing for `&&`/`||`). Registered in
  `builtinCommands`. **Follow-up:** ADR-0086 node-fs-reuse parity cases for the
  tier-c builtins (cat/head/tail/wc/basename/dirname/realpath/cp/mv) and the
  compat-matrix rows are tracked for the milestone-DoD closer (A-033); ls/grep/find
  (frozen-GNU-fixture tier) land with the SGR/columns/walker helpers in a later phase.

- **ADR-0084:** `tokenize` now returns `Token[]` (was `string[]`) — a word token
  `{ value, quoted }` carrying quote provenance, or an operator token `{ op }`.
  `quoted` is `true` iff ≥1 character of the word came from inside `'…'`/`"…"`,
  the load-bearing bit that lets the dispatcher keep `grep '*.ts'` literal while
  expanding `grep *.ts` (glob expansion lands in a follow-up). New exports:
  `Token` type + `isOp` guard. `shell.ts` consumes `Token[]` throughout
  (splitOnJoiners, env-prefix pop, redirect extraction, bare-`&` rejection via
  the `op` discriminator — not a substring match). **Public-API break** to
  `tokenize`'s return type; contained to `@riftydev/shell` (no external
  importers). Pure type-shape change — observable parse behavior is unchanged
  (the existing assertions are preserved via a `vals()` projection; the new
  `quoted` bit gets its own `tokenize-provenance.test.ts`).

- **ADR-0082:** `CommandContext` gains four optional fields — `stdin?: StdinReader`
  (async `read(): Promise<Uint8Array | null>`, `null` = EOF), `isTTY?: boolean`,
  `cols?`/`rows?: number`, and `signal?: AbortSignal` — plus a new exported
  `StdinReader` type. All optional, so every existing builtin and
  `registerCommand` registrant (incl. `npm-shell-command`) compiles and behaves
  unchanged. `RunOptions` gains optional `signal`/`isTTY`/`cols`/`rows`.
  `Shell.run` now owns a per-run `AbortController`: the host `signal` forwards
  into it, each command observes `ctx.signal`, and a SIGINT **resolves** `run`
  with exit `130` even when a handler never returns on its own (a `vite`/`node
  http` dev server) — via `Promise.race`, cooperative (not a hard kill), with
  the listener removed on settle (no leak). The redirect path (and future pipe
  RHS) forces `ctx.isTTY` false so `--color=auto` emits no SGR into a
  file/stream. **Relationship to Q-2026-06-05-317:** this foreground-dispatcher
  cancellation contract is COMPLEMENTARY to and NOT subsumed by the kernel
  worker-teardown question — cooperative shell-side abort vs kernel realm
  teardown are separate decisions, kept decoupled.
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
