---
area: shell
status: draft
title: A command list ending in `&&`, `||` or `|` is bash's end-of-file syntax error
created: 2026-11-17
why: `true &&`, `false ||` and `echo a |` run their commands and exit 0 in rifty; bash rejects the input (`syntax error: unexpected end of file`, exit 2), so a truncated agent command or script silently runs half a list
sources: [docs/public/compat/shell.md, packages/shell/fixtures/bash/grammar-table.json]
code: [packages/shell/src/tokenize.ts, packages/shell/src/shell.ts, packages/shell/src/language-service.ts]
---

## Context

GNU bash 3.2.57 (macOS 26.6.2, `/bin/bash --noprofile --norc -c`) vs rifty
`Shell.run` (MemoryFsSync cwd `/p`), 2026-11-17, PR #401 branch:

| input | bash | rifty |
|---|---|---|
| `true &&` | `syntax error: unexpected end of file`, exit 2 | exit 0, no error |
| `true \|\|` | same, exit 2 | exit 0 |
| `echo a \|` | same, exit 2, nothing printed | exit 0, `a` consumed by an empty stage |

Pre-existing on `main` before PR #401 (the operator is the last token, so the
list just ends). Not a validator/tokenizer drift
(`shell/shell-syntax-model`): the interactive terminal validator reports such
input `complete`, while bash would prompt for more; the non-interactive
`Shell.run` contract is what disagrees. Declared ⚠️ in
`docs/public/compat/shell.md`. At pickup: throw bash's syntax error before
anything runs (as the leading-operator case does), and decide whether the
terminal validator reports `incomplete` for it.
