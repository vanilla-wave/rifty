# ADR 0137: Shell PATH-style node_modules/.bin resolution + injected BinExecutor seam

Status: Accepted (2026-06-13)
Date: 2026-06

> TL;DR: A shell command miss walks up to the nearest `node_modules/.bin/<name>` shim and runs it through an injected `BinExecutor`; the shim is spawned as a `kind:'source'` kernel Worker so installed CLIs (`eslint`, `tsc`, …) are invokable by name.

## Context

`install()` writes `node_modules/.bin/<cmd>` launcher shims (`#!/usr/bin/env node` + `import('../<pkg>/<bin>')`) but the shell had no PATH-style lookup — a bare `eslint` hit "command not found" (exit 127). `npm run` special-cased `vite`/dev-script in the host runner. Closes `docs/backlog/shell/node-modules-bin-execution.md`.

Executing a Node program needs a Worker realm; the shell layer's deps are only `@riftydev/io` + `@riftydev/vfs` (no kernel). So execution can't live in the shell.

## Decision

**Resolution order (shell):** registered (builtins + `registerCommand`) → walk-up nearest `node_modules/.bin/<name>` → miss. `bin-resolver.ts` walks cwd→`/`, first file hit wins. Bare names only — a name containing `/` is a path, never a PATH lookup (bash). `which` reports the resolved shim path for installed CLIs.

**Execution (injected, not imported):** `ShellOptions.execBin?: BinExecutor` — the host supplies it. Rejected importing `@riftydev/kernel` into the shell: widens a leaf package's dep graph; the host already owns Worker spawn; mirrors the existing `npm run` `runScript` injection precedent. A resolved shim runs through the normal handler path (inherits SIGINT abort-race + `>` redirect flush).

**Exit codes:** shim found + no `execBin` → 126 ("installed, cannot execute here"), distinct from the 127 miss — never a silent stub. Executor exit code is the segment exit code.

**Host executor (playground):** `createBinExecutor` reads shim bytes and spawns `{ kind:'source', code, sourceUrl:<shimPath> }` via `globalProcessManager.spawnWorker` (the execSync/realVite pattern). `sourceUrl` anchors the shim's relative import; ESM `import()` already strips the shebang (`allowHashBang`). stdout/stderr stream to the context; `ctx.signal` kills the worker. SAB-IPC-gated (`NotImplementedError` when COI is absent).

## Consequences

- Installed CLIs invokable by name at the prompt; `which <cli>` resolves; background (`cli &`) threads `execBin` to the clone.
- Registered commands still shadow same-named shims — the playground keeps `vite` lifecycle ownership.
- New public API: `BinExecutor` type + `ShellOptions.execBin` (IRREVERSIBLE per checkpoint 1). Additive — existing `new Shell(...)` callers unchanged.
- Follow-ups (parked, gated on M6 real-worker maturity): real-Worker e2e of arbitrary `.bin` execution; routing `npm run` script lines through shell `.bin` resolution (replacing the hardcoded vite/dev switch). Tracked in `docs/backlog/shell/node-modules-bin-execution.md`.
