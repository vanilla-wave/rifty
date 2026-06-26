---
area: playground
status: active
title: `vite` dev path must not silently drop args / run unknown subcommands
created: 2026-06-26
why: the bare-`vite` fallthrough (`real-vite-bootstrap.ts` `return runDevServer(ctx)`) ignores all args — `vite --port 3000`, `vite --host`, `vite badcmd` silently boot the default dev server, a Fidelity silent-mismatch.
user_story: As a developer typing `vite --port 3000` in rifty, I want the port honored or a loud "not supported", but today the flag is silently dropped and the default-port dev server boots as if I typed bare `vite`.
sources: [ADR-0173, docs/backlog/playground/honest-vite-command-umbrella.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

`registerCommand('vite')` special-cases `build` / `preview` / `optimize`; everything
else → `runDevServer(ctx)` with args ignored. `rejectUnsupportedViteArgs` is wired for
build/preview only. So the dev/default path silently drops flags and runs the dev
server for any unrecognized token. Narrowest, no-blocker slice of the honest-vite
umbrella.

## Options or Next

Mirror the build/preview guard on the dev path:

- `vite` / `vite dev` / `vite serve` (real Vite dev aliases) with NO extra args →
  `runDevServer` (unchanged).
- A dev-path flag/arg we don't honor (`--port`, `--host`, `--mode`, `--config`, …) →
  loud reject (same shape/exit as `rejectUnsupportedViteArgs`). Honor `--port`/`--host`
  for real only if the existing config plumbing makes it cheap; otherwise loud-reject —
  never a silent no-op.
- Unknown subcommand (`vite frobnicate`) → loud "unknown command", not silent dev.

## Done when (no partial delivery)

- Every `vite <x>` either does the real Vite thing or loud-rejects with a one-line
  diagnostic + non-zero exit; NO input silently boots the dev server.
- Regression test per case: bare `vite`, `vite dev`, `vite --port 3000`, `vite --host`,
  `vite dev --port 3000`, `vite badcmd`.
- Loud-gap rule: an unsupported flag throws/rejects, never a swallowed arg.

## Reversibility

REVERSIBLE. New loud-rejects on previously-silent input are behaviour changes within
ADR-0173's honest-dispatch intent; no public API. If a `vite dev`/`serve` alias
contract is formalized, note it in ADR-0173.
