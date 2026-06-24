# @riftydev/shell — Changelog

## [Unreleased]

### Fixed

- **PR #78 review fixes for git porcelain fidelity.** Ambiguous revision/path operands now refuse with real git's `both revision and filename` fatal (including untracked worktree filenames and later `log`/`diff` operands); annotated-tag checkout/reset paths no longer corrupt HEAD via tag/tree objects; `git apply` context failures exit 1 with `patch failed` text while capability ceilings stay `NotImplementedError`; `stash push` no longer persists fallback identity into `.git/config`; merge-commit `show` renders `Merge:` and suppresses the default patch; bare `ls-remote` defaults to `origin`; `clone` with no URL exits 129 with usage; and success output now covers `reset --mixed`, `tag -d`, `git rm`, and clean `cherry-pick`. Guards: `git-cli.test.ts`.
- **`git` fidelity hardening — no silent false-successes, faithful error surfaces (ADR-0167).**
  - **Repository guard.** Every verb except `init`/`clone` now verifies a repo governs the cwd first (real git's discovery, walking up for `.git`). A NON-repo → `fatal: not a git repository (or any of the parent directories): .git` (exit 128) instead of a silent false-success (`status` had reported a clean tree, `commit` fabricated a root commit).
  - **`commit` no longer fabricates an empty commit.** Nothing staged → real git's exit-1 summary to stdout (`nothing to commit, working tree clean` / `… untracked files present` / `nothing to commit (create/copy files…)`), no commit written; `--amend` still allowed.
  - **`commit -a`/`--all` + `-am`** stage tracked modifications + deletions (not untracked) before committing (`git add -u` semantics); combined short clusters expand correctly. Any UNKNOWN `commit` flag now loud-throws (`git.commit.<flag>`, exit 128) instead of being silently ignored.
  - **`diff`** is the unstaged delta (index ↔ workdir, like bare `git diff`); untracked + ignored files are no longer shown.
  - **Core-verb error fidelity.** `log` on an unborn HEAD → `fatal: your current branch '<b>' does not have any commits yet` (128); `add` of a missing path → `fatal: pathspec '<x>' did not match any files` (128) — no leaked iso-git "Could not find …" exit-1.
  - **`clone <url> [<dir>]`** clones into a NEW subdirectory (url basename, or the explicit `<dir>`), not the cwd; a non-empty destination is refused with git's `fatal: destination path '<x>' already exists and is not an empty directory.` (128).
  - **`switch <name>`** that is neither a branch nor any ref → `fatal: invalid reference: <name>` (128), not a leaked plumbing error.
- **`git` fidelity hardening, round 2 (adversarial audit follow-ups).**
  - **Repository guard validates `.git/HEAD`**, not just a `.git` entry — a bare `mkdir .git` / empty / partial `.git` (or a `.git` FILE) is no longer accepted as a repo (was a silent false-success: `status` reported clean). Discovery keeps walking up, ending in the `not a git repository` fatal.
  - **`commit -m a -m b`** joins paragraphs (`a\n\nb`) instead of silently dropping the first; **`commit -m ''`** → git's `Aborting commit due to empty commit message.` (exit 1), not a leaked iso-git `MissingParameterError`. The one-line summary shows only the message's first line.
  - **`git add` flag discipline + all-or-nothing.** Unknown flags loud-throw `git.add.<flag>` (was silently dropped); recognizes `-A`/`--all`/`-u`/`--update`/`-f`/`--force`. Pathspecs are validated before staging (a single miss stages nothing); a gone-but-tracked path stages its deletion; an explicit ignored path is refused unless `-f`; no pathspec → git's `Nothing specified, nothing added.` advisory (exit 0, was a spurious exit 1).
  - **`git diff` never silently returns the wrong tree.** The hardening first made non-bare forms loud; the hard-ceil pass now implements `--cached`/`--staged`/`HEAD`/two-ref forms with the correct tree selection. Binary changes render `Binary files … differ`.
  - **Adversarial git hard-ceil audit fixes.** `git diff HEAD <path>` and `git diff --cached [<rev>] <path>` parse pathspecs without requiring `--`; `git log -- <path>` filters history; `git show <commit>` prints the patch; `git reset --hard <rev>` deletes tracked files absent from the target tree; `git stash pop/apply/drop stash@{n}` selects the requested entry while `stash -u` loud-throws the tracked-only stash ceiling; `git ls-remote origin` resolves configured remotes; `git rm` refuses modified tracked files unless forced; `git mv` refuses destination overwrite unless forced.
  - **Review hard-ceil fix-pass.** `remote`/`checkout -b`/`switch -c`/`merge`/`cherry-pick`/network verbs no longer ignore extra operands; unsupported merge/cherry-pick flags are loud ceilings. `git rm` separates `-r` from `-f`, validates every pathspec before mutation, and refuses directory recursion without `-r`. `git mv` proves the source is tracked before VFS writes and supports moving files into an existing directory. `reset HEAD -- <path>` parses correctly, while mode+pathspec forms loud-throw. `stash push <pathspec>` and missing `-m` values loud-throw before mutation. `clone`/`fetch` parse `--depth` and `--single-branch`; `log -n 0` prints nothing and unsupported `--format` tokens loud-throw.
  - **Usability phase 1.** Git commands now work from repo subdirectories by translating cwd-relative pathspecs to repo-root paths for add/diff/log/checkout/restore/reset/rm/mv. `diff` adds `--name-only`, `--name-status`, and `--stat`; patch output includes `---`/`+++` file headers. Network porcelain accepts single `src:dst` refspecs, `fetch --tags/--prune/--prune-tags`, `push --tags`, `ls-remote --tags/--heads`, and `clone --no-tags`; multi/wildcard refspecs remain loud ceilings.
  - **Clean patch/revert workflows.** `git revert <commit>` now handles the clean single-parent case all-or-nothing: clean worktree, touched paths still matching the reverted commit's post-image, inverse worktree/index update, and a normal `Revert "<subject>"` commit. `git apply <patch-file>` / `git apply -` now applies clean text unified diffs to the worktree (not index) with add/modify/delete support and preflighted all-or-nothing conflict detection. Unsupported conflict/sequencer/3-way/index/binary/rename/mode/mailbox forms throw directed `git.revert.*` / `git.apply.*` ceilings before mutation.
  - **`git fetch`/`pull`/`push` with a remote NAME** (`git push origin main`) resolve the remote from config instead of mistaking it for a URL transport ceiling; `-f`/`--force` honored on push; other network flags loud-throw.
  - **`git clone`**: the destination-exists guard runs before transport (so ssh + non-empty dest reports the dest fatal, not the transport ceiling); no `<url>` → git's `fatal: You must specify a repository to clone.`; a `…/.git` URL falls back to the host so the destination is never empty.
  - **Defensive error mapping** for `status`/`branch`: a corrupt-repo iso-git `NotFoundError` maps to `fatal:` exit 128 rather than leaking as the shell's generic exit 1.
  - **Review fix-pass hardening.** Cwd-relative pathspecs that resolve outside the repo now fail before reaching plumbing (no leaked isomorphic-git `RangeError` and no misleading ignored-file refusal). `git apply` now parses hunk body lines that begin with `---` as removals, and `git apply - extra.patch` loud-throws `git.apply.multiple-files` instead of silently ignoring the extra patch operand. Guards: `git-cli.test.ts`.
  - **Post-review silent-success fixes.** `git add` pathspec staging now honors `-f`, `-u <pathspec>`, directory deletions, and `-A <pathspec>` without staging unrelated paths. `git tag -m` creates annotated tags; annotated-tag editor workflows and extra operands loud-throw before mutation. `git log <path>` works without `--`; reflog revspecs in `reset` render as exit-128 ceilings; `git apply` from a subdirectory ignores patch entries outside that cwd scope; `push --tags` checks the remote transport even when no local tags exist. Guards: `git-cli.test.ts`.
  - **Hard-ceil completion pass.** `git add -f .` / `git add -f <dir>` now stages ignored children even when ordinary tracked changes also match the pathspec; `HEAD^0` resolves as the current commit across diff/log/show/reset while invalid parent revspecs no longer degrade into empty pathspec diffs or escape explicit tree-ish forms; implicit `diff`/`log` pathspecs that match no worktree/index path are fatal unless `--` is used; `checkout <bad-source> --` validates the source; `reset HEAD^0 -- <path>` unstages like `HEAD`; `git log --max-count=<non-integer>` is fatal; `git config <key> <value> <value-pattern>` and `git config --get <key> <value-pattern>` loud-throw `git.config.value-pattern` before mutation; `git apply` from a subdirectory ignores unsupported metadata for outside-cwd entries before parsing, while in-scope rename/copy/no-newline metadata maps to directed `git.apply.*` ceilings. Guards: `git-cli.test.ts`.

### Added

- **`git` porcelain expanded to the current browser/VFS hard ceiling.** The shell
  now wires `reset` (path/soft/mixed/hard), parent revspecs (`HEAD~n`, `^`) for
  checkout/restore/diff/log/show, `diff --staged`/`--cached`/`HEAD`/two-ref,
  `show`, `tag`, `remote`/`ls-remote`, clean fast-forward `merge`, clean
  `cherry-pick`, tracked-file `stash` push/list/pop/apply/drop with `stash@{n}`,
  and index-aware `git rm` / `git mv`. Unsupported flags/workflows still exit 128 through directed
  `NotImplementedError`s; no subcommand silently falls back to a different tree.
- **`git` builtin over `@riftydev/git` (isomorphic-git on the ambient VFS).**
  Local porcelain: `init`, `status` (`--porcelain` v1 `XY` + human default),
  `add <pathspec…>` (incl. `.` / `-A`), `commit -m`, `log` (+ `--oneline`),
  `diff` (structured unified-diff text), `branch`. Identity/dates derive from
  `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env (fallback `rifty`/`rifty@localhost`).
  Porcelain `XY` mapping cross-checked against real git 2.50.1. Network verbs
  (`clone <url>`/`fetch`/`pull`/`push`) drive smart-HTTP via the facade; any
  failure — unsupported-transport / cross-origin `NotImplementedError`, or a real
  network/protocol error — surfaces as exit 128 with its message on stderr
  (`pull` commits the merge under the shell-env identity; `clone` without a
  `<url>` → exit 128). Unknown subcommand → exit
  1; no ambient filesystem → exit 128. Conformance-locked: `git-fixtures.test.ts`
  byte-asserts `status --porcelain` (untracked / staged / mixed) + `log
  --oneline` against frozen real-git 2.50.1 golden fixtures
  (`packages/git/fixtures/`, ADR-0093) — never spawns git at test time.
- **`git checkout` — branch-switch + file-restore, byte-exact to real git
  2.50.1.** `checkout <branch>` (switch / already-on), `-b <name> [<start>]`
  (create+switch), `-f`/`--force`, `<full-sha>` (detached HEAD + advisory),
  `-- <pathspec…>` and `<tree-ish> -- <pathspec…>` (restore from index / tree),
  bare-positional ref↔path disambiguation (single arg: ref wins — branch
  precedence, matching real git; neither → pathspec-miss). Bare `git checkout`
  (and `git checkout --` with no pathspecs) is a clean-tree no-op (exit 0,
  silent). EVERY message goes to stderr (stdout stays empty); restore is
  silent. Typed git user-errors map to git's exact stderr: conflict refusal +
  pathspec-miss (exit 1), branch-exists (exit 128). Ceiling
  flags/args (`-B`, `--orphan`, `-p`, `-m`, `--ours`/`--theirs`, `-t`, bare `-`,
  reflog revspecs (`@{-1}`/`HEAD@{1}` → `git.checkout.revspec`),
  any unrecognized flag) and glob/magic pathspecs throw
  `NotImplementedError('git.checkout.<x>')` exit 128 — loud, never silent.
  Conformance-locked: `git-fixtures.test.ts` byte-asserts switch/create/already/
  conflict/detached/restore (both streams) against frozen real-git fixtures
  (`packages/git/fixtures/checkout-*`); the detached test pins the canonical SHA
  `7fdebb4…`.
- **`git switch` / `restore` / `config` + `commit --amend` + identity from
  config.** `switch <branch>` / `-c [<start>]` / `--detach <commit>` (branch-only,
  reuses the checkout engine; byte-exact stderr vs git 2.50.1 — `switch --detach`
  prints the HEAD-line ONLY, no advisory block; a non-`--detach` commit →
  `fatal: a branch is expected, got commit` exit 128; `switch -` →
  `NotImplementedError('git.switch.previous')`). `restore [--staged]
  [--source=<tree>] <pathspec…>` (worktree from index/tree, or `--staged`
  unstage via `resetIndex`; silent like git; `--staged --source` →
  `git.restore.staged-source`; parent revspec source (`HEAD~1`, `main^`) is
  supported; no-match → pathspec-miss exit 1). `config <key>` / `config <key>
  <value>` (bounded get/set on `.git/config`; unset key → exit 1 silent;
  `--list`/other flags → `git.config.<flag>` exit 128). `commit --amend`
  replaces HEAD (reuses the prior message when no `-m`). Author identity now
  resolves `GIT_AUTHOR_*` env → `user.name`/`user.email` config → built-in
  default, so `git config user.email x` then `git commit` (no env) authors as x.
  Conformance-locked: `git-fixtures.test.ts` byte-asserts switch
  (existing/create/already/detached) + restore (worktree/staged) against frozen
  real-git 2.50.1 fixtures (`packages/git/fixtures/{switch,restore}-*`).
- **Installed CLIs invokable by name — PATH-style `node_modules/.bin` lookup
  (ADR-0137).** A command miss now walks up to the nearest
  `node_modules/.bin/<name>` launcher shim (resolution order: registered
  builtins/commands → walk-up → miss) and runs it through an injected
  `BinExecutor` (`ShellOptions.execBin`). Bare names only — a name containing
  `/` is a path, never a PATH lookup. A shim found with no executor wired ⇒
  exit 126 ("installed, cannot execute here"), distinct from the 127 miss —
  never a silent stub. `which <cli>` now reports the resolved shim path; a
  builtin still shadows a same-named shim. New public API: the `BinExecutor`
  type. Closes the historical shell `.bin` execution backlog.

### Fixed

- **`git` restore/config/amend ceilings now throw LOUD at exit 128, never leak as
  a generic exit-1.** `git restore` with no pathspec renders via the restore error
  renderer (`git.restore.no-pathspec`, exit 128) instead of escaping uncaught to
  the shell handler. `git config` flag/no-key ceilings use the typed
  `NotImplementedError('git.config.<flag>')` (message-format parity with the
  compat matrix; `--list` etc. stay byte-identical at exit 128). `commit --amend`
  on an unborn HEAD (fresh repo, no commit) now prints `fatal: You have nothing
  to amend.` exit 128, not the leaked iso-git `Could not find HEAD` exit-1.

- **Trailing `&` after a compound separator now backgrounds only the final
  segment.** `echo a ; slow &` runs `echo a` in the foreground and starts only
  `slow` as a background job; `&&`/`||` short-circuit semantics are preserved.

- **Review pass 2026-06-07** (see `docs/backlog/review-2026-06-07.md`):
  - **`rm -rf $UNSET` no longer wipes the cwd.** An unquoted word that expands to
    nothing (`$UNSET`) is now elided (bash word-splitting) in `expandArgs`, so it
    can't collapse to an empty path that resolves to cwd. A quoted `''` still survives.
  - **`>>` append of non-ASCII no longer drops data.** The append buffer was sized
    by `stdout.length` (UTF-16 code units) but filled with UTF-8 bytes → `RangeError`
    → `[EREDIRECT]`. Now sized by encoded byte length.
  - **Redirect:** truncates/creates the target even when the command writes nothing
    (`grep nomatch x > f` empties `f`); extracts a `>`/`>>` from anywhere in the
    command (not just the final two tokens — `echo hi > f extra` no longer leaks
    `>` as a literal arg); allows a target that starts with `-`.
  - **Trailing `;` no longer resets the exit code to 0** (`false ;` ⇒ 1) — empty
    segments are skipped.
  - **Command-thrown errors render as `cmd: message`, not a JS stack trace.**
  - **`rm`/`mkdir`/`touch` flag parsing rewritten** to the shared convention
    (bundled short flags, `--`, **loud `NotImplementedError` on unknown flags**):
    `rm -fr`/bundles now work; `mkdir -pv`/`touch -c` no longer create a file/dir
    literally named after the flag; `rm DIR` without `-r` is refused; missing-operand
    handled; GNU `strerror` messages.
  - **`mv SRC EXISTINGDIR`** lands at `DIR/basename` (GNU — file AND dir sources;
    was EISDIR for files / direct-rename-ENOTEMPTY for dirs). ENOTEMPTY now surfaces
    only on a real overwrite (`DIR/basename` already a non-empty dir). `mv` errors
    now use the shared GNU `strerror` wording (`cannot stat`/`cannot move`).
  - **`grep -r`** prints matched paths as-given (relative to the start path, like
    `find`) instead of absolutized — e.g. `grep -r x .` → `./a.txt`, not `/abs/a.txt`.
  - **`ls -l ABSOLUTE_FILE`** from a non-root cwd no longer crashes (resolve, not raw
    join); **`ls` column widths** now ignore SGR colour bytes (alignment under
    `--color`).
  - **`head` with no FILE** returns a clean exit 1 (matching cat/tail/wc) instead of
    throwing.

### Refactor

- `strerror` (errno→GNU text) and `escapeRegExp` consolidated into `_shared.ts`;
  `cat`/`cp`/`wc`/`grep`/`mkdir`/`rm`/`touch` + `_glob` now import them (was copy-pasted).

### Added

- **Command-not-found suggestions (ADR-0104).** Unknown commands still exit 127,
  but close typos now print one conservative `Did you mean 'cmd'?` diagnostic
  from the current command registry, including custom `registerCommand`
  commands. Distant names stay quiet.
- **Command-name completion seam (ADR-0104).** `Shell.commandNames()` returns a
  sorted list of builtin + registered command names so hosts can complete argv-0
  without reaching into the private command registry.
- **Shell env snapshot seam (ADR-0116).** `Shell.envSnapshot()` returns a
  defensive copy of the mutable shell env so hosts can persist terminal state
  without exposing the internal env object.
- **Inline image producer (ADR-0105).** New `img` builtin emits a tiny iTerm
  inline-image PNG sequence on TTY output and writes nothing on non-TTY output.
- **Core command allowlist (ADR-0120).** `coreCommandNames()` exposes builtin
  coreutils only, excluding host-registered commands such as `npm`; playground AI
  command suggestions use it as their safety boundary.
- **Background jobs (ADR-0121).** Trailing `cmd &` starts a shell-level
  background job in a cloned shell, returns the prompt immediately, streams
  output through `onChunk`, and records status in the new `jobs` builtin.
  Non-trailing/nested `&`, pipes, and input redirect stay loud unsupported paths.
- **Foreground stdin and mouse demo (ADR-0122).** `RunOptions.stdin` now flows
  to `ctx.stdin`, and the new `mouse-demo` builtin enables DECSET 1000/1006,
  reads one raw input chunk, then prints escaped bytes for browser e2e coverage.
- **OSC 8 grep file links (ADR-0105).** In interactive TTY output, `grep`
  filename prefixes are wrapped in OSC 8 `file://` links to their resolved VFS
  path while preserving the GNU/as-given label. Non-TTY output stays byte-stable.
- **Rich terminal builtins:** rich `ls` (column layout via `_columns`, `-l`/`-a`/`-1`,
  `--color=auto/always/never` SGR via `_sgr`), `grep -r/-n/-i/-v/-c` (tri-state
  exit 0/1/2), `find` (path/`-name`/`-type` over `_walk`), `which NAME...`
  (presence probe injected from the shell — no reverse import), `clear`, `sleep`.
  Glob expansion of unquoted args wired in the dispatcher (`_glob`). New shared
  helpers under `src/commands/`: `_walk` (recursive VFS tree walk), `_sgr` (SGR
  color codes), `_columns` (terminal column packing), `_glob` (segment matcher).
  Legacy inline builtins (`pwd`/`cd`/`mkdir`/`rm`/`env`/`touch`) relocated to
  their own `commands/<cmd>.ts` files; `builtinCommands` now takes a `hasCommand`
  probe (second param) to wire `which`.
- **ADR-0088 (file-arg coreutils):** new pure-JS builtins over `syncMirror()`, one
  file each under `src/commands/` + a `_shared.ts` (`resolve`/`enc`/`dec`):
  `cat -n/-b/-A/-E`, `head -n/-c` (incl. negative-N), `tail -n/-c` (incl. `+N`;
  `-f` throws), `wc -l/-w/-c/-m`, `cp [-r] [-n]` (over `copyFileSync`/`cpSync`),
  `mv [-n]` (over `renameSync`, mtime-preserving), `basename`/`dirname`/`realpath`
  (path-math; realpath is normalize+exists, no symlinks per ADR-0050), `seq -s/-w`,
  `true`/`false`, `printf` (`%s %d %x %o %c %%` + escapes, arg-recycling), and an
  upgraded `echo -n/-e/-E`. Every unimplemented flag throws
  `NotImplementedError('shell.<cmd>.<flag>')` (no silent stub); each defines its
  GNU-faithful exit code (load-bearing for `&&`/`||`). Registered in
  `builtinCommands`. **Follow-up:** ADR-0093 node-fs-reuse parity cases for the
  tier-c builtins (cat/head/tail/wc/basename/dirname/realpath/cp/mv) and the
  compat-matrix rows are tracked for the milestone-DoD closer (A-033); ls/grep/find
  (frozen-GNU-fixture tier) land with the SGR/columns/walker helpers in a later phase.

- **ADR-0091:** `tokenize` now returns `Token[]` (was `string[]`) — a word token
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

- **ADR-0089:** `CommandContext` gains four optional fields — `stdin?: StdinReader`
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
