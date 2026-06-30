---
area: shell
status: ready
title: Shell command substitution `$(…)` / `` `…` `` — LOUD, not silent
created: 2026-06-08
why: not parsed — tokenizer passes `$(…)`/backticks through as LITERAL characters, so `echo $(date)` silently prints the literal text (a Fidelity violation: silent-wrong, not loud-gap)
user_story: As a developer at the rifty shell prompt, I want `echo $(date)` to either splice the sub-command's stdout or fail loudly, but today the tokenizer emits the literal `$(date)` with no inner evaluation and no error — the worst outcome.
epic: frictionless-first-poke
blocked_by: []
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [packages/shell/src/tokenize.ts]
---

## Context

`tokenize.ts` lists `$(…)` / `` `…` `` / `$((…))` under "Deliberately NOT supported" and passes them through literally: at `$(`, `expandVarAt` sees `(` (not a var name) → returns a literal `$` and the rest is read as ordinary word chars → `echo $(date)` yields the word `$(date)`; a bare backtick is appended verbatim in the unquoted and double-quoted branches. So the user gets the LITERAL string with no error — a silent-wrong Fidelity violation. The epic's launch slice is to make this LOUD (full splice rides the [[pipes]] infra, deferred). Precedent: the tokenizer already throws on `${VAR:-default}` (tokenize.ts:77), surfacing via the `run()` rejection path (pty-server.ts:144) — the same path this throw uses.

## Acceptance

- The tokenizer throws `NotImplementedError('shell.command-substitution', …)` with a directed message (names the unsupported construct + that it is not yet spliced) when an UNQUOTED or DOUBLE-QUOTED `$(` or backtick `` ` `` appears — exactly the contexts where bash performs command substitution.
- SINGLE-quoted `$(…)` / backticks stay LITERAL with NO throw (`echo '$(date)'` prints `$(date)` — bash-faithful: single quotes suppress substitution).
- Arithmetic `$((…))` is caught by the same `$(` guard (loud, not silent) — better than the prior literal pass-through; full arithmetic stays out of scope.
- Surfaces as a clean shell diagnostic via the existing `run()` rejection path (same as `${VAR:-default}`), not an uncaught crash.

## Parity cases

- `echo $(date)` → throws (loud), exit non-zero diagnostic; NOT the literal `$(date)`.
- `echo \`pwd\`` (unquoted backticks) → throws.
- `echo "$(date)"` (double-quoted) → throws (bash substitutes inside `"…"`).
- `echo '$(date)'` (single-quoted) → prints `$(date)` literally, exit 0 (no throw).
- `echo $((1+1))` → throws (loud); arithmetic is not silently passed as literal.

## Out of scope

- ACTUAL substitution splice (recursively run the inner line, splice trailing-newline-trimmed stdout) — deferred; rides the [[pipes]] dispatcher-reachable-from-tokenizer work.
- Arithmetic `$((…))` evaluation, process substitution `<(…)`, word-splitting of a substituted result — no implementation, only the loud throw.

## Decisions

- Detect at the TOKENIZER's expansion path (unquoted + double-quoted), NOT a post-tokenize scan — this matches bash quoting precisely (single-quote literal; unquoted/double-quoted attempted→loud) and reuses the established `${VAR:-x}` throw surface.
- LOUD throw over silent literal is the whole point (Fidelity); the full splice is a separate follow-up, recorded here.
- REVERSIBLE — internal to packages/shell tokenizer. CHANGELOG in packages/shell; no ADR.
