---
area: playground
status: ready
title: node CLI flags — `-v/--version`, `-e/-p`, and `bad option` for unknown flags
created: 2026-06-30
why: the `node` command absolutizes argv[0] with zero flag parsing, so `node --version` AND every `node -e "…"` fail identically with `Cannot find module '/workspace/--version'` — the universal first sanity check and the file-less one-liner path both throw, gating the whole runtime-exploration poke (sha256/Date/fetch/randomUUID all work but are unreachable).
user_story: As a curious first-timer in the terminal, I want `node --version` and `node -e "console.log(1+1)"` to work like real Node, but today the handler passes `args[0]` straight to `resolveNodeEntry` which absolutizes any non-empty arg → MODULE_NOT_FOUND, silently dropping the version request and the eval source.
epic: frictionless-first-poke
blocked_by: []
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/workers/node-entry-resolve.ts]
---

## Context

`shell.registerCommand('node', …)` (`real-vite-bootstrap.ts:780`) calls `resolveNodeEntry(ctx.cwd, args[0])` (`node-entry-resolve.ts:18`), which absolutizes ANY non-empty arg against cwd with no existence check and no flag branch. So `node --version` → `/workspace/--version` → real Node `Error: Cannot find module … { code:'MODULE_NOT_FOUND' }` exit 1; `node -e "…"` → `/workspace/-e` and the source string is dropped. `process.version` already exists (`process-identity.ts:16`, `v24.0.0`) but the CLI can't surface it. A faithful `-e/-p` must run the source through the real module-loader realm (require/import/top-level-await), NOT `new Function`.

## Acceptance

- `node -v` / `node --version` → stdout `v24.0.0\n` (the live `process.version`), exit 0, no path resolution.
- `node -e "<src>"` / `--eval <src>` → run `<src>` through the real module-loader realm (require/import faithful, NOT `new Function`); no implicit print; exit 0 on success, the real error + exit 1 on throw.
- `node -p "<expr>"` / `--print <expr>` → eval `<expr>`, write `util.inspect(result) + '\n'` to stdout, exit 0.
- ANY other leading-`-` arg (e.g. `--frobnicate`, `--env-file=.env`, `-i`, `--inspect`) → stderr `node: bad option: <flag>\n`, exit 9 — never a MODULE_NOT_FOUND on a `/workspace/<flag>` path.
- A non-flag path arg keeps today's behavior (absolutize + run; a real miss → faithful MODULE_NOT_FOUND).

## Parity cases

- `node -v` → `v24.0.0\n`, exit 0.
- `node -e "console.log(2+2)"` → `4\n`, exit 0.
- `node -p "1+1"` → `2\n`, exit 0.
- `node -e "process.exit(3)"` → no output, exit 3.
- `node -e "console.log(require('node:os').platform())"` → resolves the builtin through the loader (proves not `new Function`).
- `node --frobnicate` → stderr `node: bad option: --frobnicate\n`, exit 9.

## Out of scope

- Bare `node` interactive REPL — stays the documented ceiling (missing-entry usage error; ADR-0155). `-e/-p` need no interactive stdin, so they are in scope; the REPL is not.
- `--env-file=.env` ACTUAL loading — only the `node: bad option` loud-throw is in scope here (better than a misleading MODULE_NOT_FOUND); real `.env` parsing is a separate item.
- `-c/--check`, `-r/--require`, `--input-type`, `--inspect`, `-i/--interactive` IMPLEMENTATIONS — all route to the same `node: bad option` path (named, not faked).

## Decisions

- `-e/-p` run through the existing node-entry module-loader realm (not `new Function`) — keeps require/import/top-level-await faithful, the whole point of running on the real loader.
- Unknown leading-`-` → `node: bad option: <flag>` exit 9 (Node's shape), chosen over silently absolutizing it into a module path.
- REVERSIBLE (playground UX, no public API) → CHANGELOG in apps/playground; no ADR.
