# ADR 0337: Node eval script launch over node-entry v3

Status: Accepted
Date: 2026-07-30

> TL;DR: CommonJS CLI eval is an exact node-entry v3 launch whose supervised
> child executes one loader-owned unwrapped script with Node's synthetic
> `[eval]` module identity and deferred print lifecycle.

## Context

ADR-0155's Workbench `node` command rejects `-e`/`-p`. The retired
temporary-file path changed `argv`, filename, resolver base, cache, and stack
identity and could leave workspace bytes. Running a normal CJS file under a
synthetic filename is still observably wrong: Node 24 runs eval as an unwrapped
script, keeps its synthetic module out of `require.cache`, and prints `-p`'s
completion value at natural process exit after asynchronous side effects.

The v2 node-entry launch union has only program and worker-thread roles. Source,
exact `process.execArgv`, print mode, and entryless `process.argv` cannot be
derived from either role without an environment/file side channel or a
permissive option-bag change. ADR-0267 requires a new protocol version and an
atomic migration for that shape change.

## Decision

- Atomically replace `rifty.node-entry/v2` with
  `rifty.node-entry/v3`; there is no v2 reader or fallback. V3 retains the exact
  program and worker-thread variants and adds one exact-own `eval` variant:
  source, print mode, original eval `execArgv`, remote-FS provenance, preview
  scope, and terminal snapshot. Eval has no program path, bin/serve role, or
  public IPC.
- Workbench parses the supported Node 24 eval spellings and launches the same
  admitted foreground Worker used by `node <file>`. The process spec carries
  `[process.execPath, ...scriptArgs]`; source and `execArgv` travel only in the
  typed bootstrap. Existing private control, PTY, output cut/drain, signals,
  preview ownership, and one-shot process adoption remain authoritative.
- Runtime-js owns one package-internal CommonJS eval-script seam beside the CJS
  loader. It creates a detached synthetic module record with Node's `[eval]`
  identity and cwd-anchored resolver, evaluates source once as an unwrapped
  script, and returns the script completion value. It does not register the
  record or widen the public `ModuleLoader` API. A temporary/data module,
  normal CJS wrapper, per-surface evaluator, and one-off `new Function` are
  forbidden.
- Print mode captures that completion value and uses Node console's one-argument
  formatting. It prints once from the existing natural-exit lifecycle after
  tracked work drains, with exit as the fallback; an explicit `process.exit`
  suppresses it. Promise inspection observes only the returned value without
  replacing the realm's Promise or changing guest-visible constructor
  identity.
- CommonJS eval is the only new runtime context. ESM eval, preload/import
  options, and the bare REPL remain distinct loud gaps.

## Consequences

- Eval gains real loader resolution, process supervision, and Node-visible
  identity without workspace writes or a second lifecycle.
- Every node-entry producer, validator, recursive inheritance path, and
  duplicated-bundle consumer migrates to v3 in one cut.
- Differential tests must cover CLI spelling/`execArgv`, entryless `argv`,
  synthetic-module identity and cache absence, cwd resolution, delayed result
  formatting, errors/exits, and concurrent child isolation.
- Fulfilled/rejected Promise and circular-reference printing deepen the shared
  inspector only where Node's one-argument console contract requires it; broad
  `util.inspect` option parity remains separate.

Specifies the eval role omitted by ADR-0155 and preserves ADR-0152/0157,
ADR-0267, ADR-0326, ADR-0325, ADR-0332, and ADR-0334.
