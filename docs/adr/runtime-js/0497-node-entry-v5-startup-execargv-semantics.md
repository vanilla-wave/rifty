# ADR 0497: Node entry v5 startup execArgv semantics

Status: Accepted
Date: 2026-10-01

## Context

Real Vitest 4.1.11 forwards require preloads, conditions and resolve-parent flags
to forks and threads. V4 drops fork flags and rejects Worker flags. Public argv
identity cannot be reconstructed from normalized effects.

## Decision

Keep ADR-0267's atomic envelope; migrate all producers/readers to exact v5.
Every program/eval/worker-thread launch requires one frozen raw `execArgv` array.
No parsed duplicate, guest-env carrier, kernel option bag or handshake.

`process.execArgv` is a mutable copy. Worker inherits the immutable launch array,
recursively; explicit options replace it, including `[]`. Fork inherits current
public argv and removes default eval/print source pairs; explicit options replace it.

One loader derives require preloads, custom conditions and experimental
import-meta-resolve parent support. Preloads execute before entry using its cache.
Conditions are per-loader and preserve package declaration order. Path Workers
retain source-bearing eval flag identity without evaluating that source.
Unsupported effects throw named ceilings; same-realm startup effects remain loud.

Partially supersedes ADR-0339's retained program/worker shapes and supported
require-preload gap; partially supersedes ADR-0416's active v4 version.
Eval identity/lifecycle, SQLite configuration and dev-server protocol stay.

DEC-2 independent decision: exec_argv_decision; Node differential raw proof in
`docs/backlog/runtime-js/reference/vitest-execargv-decision.md`.

## Consequences

- Fork/thread startup effects share existing loader and bootstrap authority.
- Every launch explicitly carries raw identity; v4 has no fallback decoder.
- --import, unsupported Node flags and same-realm effects remain loud gaps.
