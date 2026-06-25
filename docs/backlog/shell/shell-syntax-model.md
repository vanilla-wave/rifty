---
area: shell
status: active
title: Shared shell syntax model for execution and language service
created: 2026-06-25
why: Execution and terminal language tooling parse shell input separately today, so highlighting, validation, completion, and actual command execution can drift.
user_story: As a developer typing in the rifty terminal, I want validation, highlighting, completion, and execution to agree about what my command means, but today each layer scans shell syntax with its own rules.
sources: [Q-2026-06-25-shell-research, ADR-0091, docs/backlog/terminal/reference/terminal-ux-research-2026-06-08.md]
code: [packages/shell/src/tokenize.ts, packages/shell/src/shell.ts, packages/shell/src/language-service.ts, packages/shell/src/index.ts]
---

## Context

`tokenize()` and the shell dispatcher define executable syntax. The language
service separately scans operators, quotes, strings, brackets, command positions,
and path fragments. That makes the terminal UI a shallow parallel shell parser.

Example risk: the validator can treat syntax as incomplete even when the real
shell tokenizer would pass it as a literal word. Conversely, execution changes
can land without updating completion or highlighting.

## Options or Next

1. Introduce a `ShellSyntax`/`ShellLanguageModel` module that returns tokens,
   source spans, quote provenance, operator positions, command positions, and
   validation facts.
2. Preserve the existing public `tokenize` contract from ADR-0091 unless an ADR
   explicitly changes it.
3. Rebuild validation, highlighting, completion, and execution helpers as
   adapters over the shared syntax result.
4. Add regression tests for quoted operators, escaped quotes, incomplete quotes,
   command position after `&&`/`;`, and literal unsupported grammar.

## Reversibility

REVERSIBLE as an internal refactor if `tokenize()` output stays compatible.
Changing exported token shapes or parse errors is IRREVERSIBLE enough to require
decision-workflow review.
