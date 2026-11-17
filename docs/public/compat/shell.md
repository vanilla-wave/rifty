# Compatibility matrix — Shell command language

Hand-maintained. Covers the command-line grammar of `@riftydev/shell`, used by the COI terminal,
no-COI project commands (agent `shell` tool) and `npm run` scripts. It is a bash subset, not a
POSIX shell. Reference: frozen GNU bash 3.2.57 capture
`packages/shell/fixtures/bash/command-lists-bash-3.2.57.json` (ADR-0093 frozen tier), asserted by
`packages/shell/tests/command-lists.test.ts` and, on the no-COI command path,
`tests/no-coi/no-coi-shell-command-lists.spec.ts`. Operators and reserved words are one closed table,
`packages/shell/fixtures/bash/grammar-table.json` (POSIX XCU Issue 7 + bash 3.2.57), each entry
implemented or loud. Commands themselves (builtins, VFS bins, `node`,
`npm`) are out of this page; a name with no command is `command not found`, exit 127.

| Feature | Status | Notes |
|---|---|---|
| Words, `'…'` / `"…"` quoting, `$VAR` / `${VAR}`, word-initial `~` | ✅ | `packages/shell/tests/shell.test.ts` (tokenize) |
| `;`, `&&`, `\|\|` lists | ✅ | Each command expands `$VAR` after earlier ones ran (`X=1; echo $X` → `1`); a prefix `X=v cmd $X` still expands the outer value. Fixture `assign-*` |
| Newline-separated lists | ✅ | Unquoted newline ends a command; after `&&`, `\|\|`, `\|`, `;`, `&` or a blank line it joins. Quoted newlines stay literal (`node -e "…\n…"`). Fixture `newline-*` |
| Line continuation | ✅ | Unquoted or double-quoted backslash-newline is removed before lexing, so it also joins operators (`&\⏎&`) and `$\⏎NAME`; `'…'` and comment text keep it. Fixture `continuation-*`, `double-quoted-continuation` |
| `#` comments | ✅ | Word-initial unquoted `#` to end of line; mid-word, quoted or escaped `#` is literal. The terminal validator ignores comment text. Fixture `comment-*` |
| `>`, `>>`, `<`; IO_NUMBER `1>`, `1>>`, `0<` | ✅ | Anywhere in a simple command, rightmost wins; fd 1 / fd 0 spelled out is the same redirect. Quoted or escaped digits (`'2'>f`) stay an argument. `input-redirect.test.ts`, fixture `op-*`, `io-number-*` |
| `\|` pipelines | ⚠️ | Stages run one after another; each stage's stdout bytes feed the next (ADR-0198). An assignment-only stage does not persist (bash subshell), a `cd` stage does: `backlog/shell/pipeline-stage-subshell-cwd`. `pipes.test.ts` |
| Glob `*`, `?`, `[…]` (single path segment) | ⚠️ | Quoted patterns stay literal (ADR-0091); a backslash-escaped glob character still expands: `backlog/shell/escaped-glob-quoting`. `glob.test.ts` |
| `**`, brace `{a,b}` | ⚠️ | Passed through literally; bash expands them (ADR-0091 deferral) |
| Unquoted `$VAR` word splitting | ⚠️ | Not split on `IFS`: an expansion stays one word |
| Special parameters `$?`, `$$`, `$#`, `$0`, `$1`… | ⚠️ | Passed through literally: `backlog/shell/special-parameter-exit-status` |
| fd redirects: other IO numbers (`2>f`, `2>/dev/null`, `3<f`), `>&`, `<&`, `&>`, `<>`, `>\|` | ❌ | `NotImplementedError('shell.fd-redirect')` before anything runs (so `2>&1`, `>&2`); stderr is never redirected: `backlog/shell/fd-redirects`. Fixture `fd-*` |
| Process substitution `<(…)`, `>(…)` | ❌ | `NotImplementedError('shell.process-substitution')` before anything runs, also after a redirect (`cat < <(…)`, `echo a > >(…)`). Fixture `process-substitution-*` |
| Trailing `cmd &` | ⚠️ | COI terminal: background job + `jobs`. No-COI project commands: `NotImplementedError('shell.background')` before anything runs (ADR-0418). Non-trailing `&` throws `shell.background`. `shell.test.ts` |
| Heredoc `<<`, `<<-` | ❌ | `NotImplementedError('shell.heredoc')` before any command runs; the body is never run or lexed. Write the body with a file tool, then `< file`: `backlog/shell/heredoc`. Fixture `heredoc-*` |
| Here-string `<<<` | ❌ | `NotImplementedError('shell.here-string')`, same atomicity. Fixture `here-string*` |
| Compound commands | ❌ | `NotImplementedError('shell.compound-command')` before any command runs, for a literal reserved word (`if then elif else fi for while until do done case esac select in function time { } ! [[ ]]`) at command position, any unquoted `(` / `)` (subshell, `name ()` function, `((…))`), or `;;`. Reserved words as arguments or redirect targets, and quoted, escaped (`\if`, `\(`) or expanded words, stay literal. Fixture `compound-*`, `reserved-*` |
| Syntax errors: list operator where a command must start, redirect without a target | ⚠️ | `a⏎&& b`, `a⏎\| b`, `echo hi >⏎b`, `cat < <EOF` throw `shell: syntax error near unexpected token …` before anything runs, with bash's token text (except a fd number right after a dangling redirect: `echo hi > 1>f` names `>` where bash names `1`); bash runs the lines before it, then exits 2. Fixture `syntax-*` |
| List ending in `&&`, `\|\|` or `\|` | ⚠️ | Runs the commands before it (`true &&` → exit 0); bash: `syntax error: unexpected end of file`, exit 2: `backlog/shell/trailing-list-operator-eof` |
| Command substitution `$(…)`, backticks, `$((…))` | ❌ | `NotImplementedError('shell.command-substitution')`; single-quoted forms stay literal. `shell.test.ts` |
| `${VAR:-x}`, `${#VAR}` and other parameter forms | ❌ | Throw `shell.tokenize: unsupported variable expansion form`: `backlog/shell/parameter-expansion` |
| `export`, `exit`, `test` / `[`, `source` | ❌ | Not shell builtins here: `command not found`, exit 127 |

Legend: ✅ implemented and tested · ⚠️ partial / known caveat / exact-version ceiling · ❌ not implemented (throws `NotImplementedError` or `UNSUPPORTED_PROTOCOL`).
