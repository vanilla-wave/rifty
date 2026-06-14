---
area: shell
status: active
title: Output-redirect targets bypass glob/quote pipeline — diverges from ADR-0091 §40
created: 2026-06-13
why: ADR-0091 §40 ratifies that a redirect target like `> *.log` follows the same unquoted-expand rule as argv, but shell.ts captures the target verbatim and splices it out of `rest` BEFORE the glob/quote pass runs, so an unquoted glob target writes a literal `*.log` file and a quoted target's provenance is silently ignored.
user_story: As a developer at the rifty shell prompt, I want `echo hi > *.log` to expand the target like argv does (and `> '*.log'` to stay literal), but today the redirect target skips the glob/quote pass and writes a literal `*.log` file.
sources: [ADR-0091]
code: [packages/shell/src/shell.ts]
---

## Context

runSegment extracts the redirect into redirectTo={path:target.value,append} at shell.ts:501 and removes the op+target pair from `rest` at :502. The glob/quote pipeline (expandArgs -> expandGlob) is applied only to rest.slice(1) (the arguments) at :508, so the redirect target never reaches expandGlob and its quoted flag is never consulted. Glob IS implemented for argv (glob.test.ts passes), so this is a targeted divergence on the redirect path, NOT the parked glob-not-implemented item. No test exercises a glob/quoted target in redirect position. Distinct from glob-expansion.md (parked) and input-redirect.md (`<` redirect).

## Options or Next

Route the redirect target through the same expand step before storing it: when unquoted and hasGlobMeta(value), run expandGlob and apply bash's ambiguous-redirect rule (>1 match -> 'ambiguous redirect' error; exactly 1 -> use it; 0 -> literal pass-through). When quoted, keep the literal value. Add a failing parity/unit case first: `echo hi > *.log` with one match expands; quoted `> '*.log'` stays literal; multi-match errors.

## Reversibility

REVERSIBLE — backlog item; internal to packages/shell, reuses existing expandGlob + Token.quoted, no cross-package API change.
