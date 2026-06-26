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

## Decisions (pre-resolved, v1 — do not re-litigate)

- **v1 loud-rejects ALL dev-path args** — `--port`, `--host`, `--mode`, `--config`,
  `--help`, `--version`, and any unknown subcommand. Do NOT thread `--port`/`--host` into
  the dev-server child in v1 — fully honest beats partially honored; real honoring is the
  follow-up below.
- **Only `vite`, `vite dev`, `vite serve` (no extra args) boot the dev server** — real
  Vite's dev aliases; everything else is a loud gap.
- **`--help` / `--version` loud-reject in v1** — real CLI prints these; that arrives with
  `honest-vite-real-bin-dispatch`. Never silently boot dev.
- **Extract a pure `classifyViteCommand(args)`** (→ `dev` | `build` | `preview` |
  `optimize` | `{reject, msg}`) out of the inline `registerCommand('vite')` callback so the
  dispatch is UNIT-testable (the bootstrap closure is not). Tests target the classifier; one
  e2e covers wiring.

## Next

Apply the classifier in `real-vite-bootstrap.ts`; reuse `rejectUnsupportedViteArgs`'s
shape/exit for the dev-path rejects.

## Follow-up (tracked, not this item)

Real `--port` / `--host` honoring on the dev path — lands naturally with
`honest-vite-real-bin-dispatch` (the real CLI parses them); do not pre-build the plumbing.

## Done when (no partial delivery)

- Every `vite <x>` either does the real Vite thing or loud-rejects with a one-line
  diagnostic + non-zero exit; NO input silently boots the dev server.
- Regression test per case: bare `vite`, `vite dev`, `vite serve`, `vite --port 3000`,
  `vite --host`, `vite dev --port 3000`, `vite --help`, `vite --version`, `vite badcmd`.
- Loud-gap rule: an unsupported flag throws/rejects, never a swallowed arg.

## Reversibility

REVERSIBLE. New loud-rejects on previously-silent input are behaviour changes within
ADR-0173's honest-dispatch intent; no public API. If a `vite dev`/`serve` alias
contract is formalized, note it in ADR-0173.
