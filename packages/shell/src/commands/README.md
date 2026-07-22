# commands — shell builtins

One user-invocable command per file (`ls.ts`, `grep.ts`, …); `_*.ts` = helpers
shared by several commands (columns, glob, walk, git plumbing). Output and
flags pinned against real tool behavior; unsupported flags throw loudly.

Belongs here: one command or a `_`-prefixed shared helper. Doesn't: shell
parse/execute engine (→ `../shell.ts`, `../tokenize.ts`), bin resolution
(→ `../bin-resolver.ts`), terminal rendering (→ `@riftydev/terminal`).
