# ADR 0099: Command-not-found suggestions

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: unknown shell commands may print one conservative “Did you mean …?” hint; exit stays 127

## Context

Terminal UX backlog asks for did-you-mean diagnostics at the shell error site. Today an unknown command only emits `cmd: command not found`. The shell owns the command registry, including custom registered commands, so it has the right suggestion source without reverse imports.

## Decision

On command-not-found, compute one best candidate from `this.commands.keys()` using a small Damerau-Levenshtein distance:

- emit `Did you mean '<name>'?` only when distance is conservative;
- include custom registered commands;
- keep exit code 127 and do not auto-correct/execute.

No dependency.

## Consequences

- Typos like `grpe` guide users toward `grep`.
- Random unknown commands stay quiet beyond the existing error.
- Suggestion policy is test-defined, not GNU parity.

## Acceptance

- [x] Tests cover builtin typo, custom command typo, no noisy suggestion, and exit 127.
- [x] `packages/shell/CHANGELOG.md` records the behavior.
