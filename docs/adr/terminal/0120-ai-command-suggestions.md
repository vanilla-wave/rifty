# ADR 0120: AI command suggestions

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: `# prompt` asks opt-in endpoint, ghost-fills safe coreutil

## Context

Backlog asks for AI command suggestions: `#` prefix, endpoint/key, coreutils
constraint, opt-in, never auto-run. Browser client cannot hide API keys.

## Decision

- `RiftyTerminalOptions.ghostSuggestion(state, signal)` is the public terminal
  seam; terminal renders dim text, accept replaces the line, never submits.
- Disabled unless `VITE_RIFTY_AI_COMMAND_SUGGEST_URL` is set.
- Optional `VITE_RIFTY_AI_COMMAND_SUGGEST_KEY` is sent as Bearer; client-visible,
  use only with same-origin proxy/dev keys.
- `# prompt` in shell modes calls the endpoint; REPL stays normal.
- Endpoint returns `{ command }` or `{ suggestion }`.
- Suggested first word must match `@riftydev/shell` core command names, not
  host-registered commands such as `npm`.
- Compound commands with joiners/redirection/background/newline are rejected.
- Enter on raw `# prompt` in shell modes is no-op; accepting the ghost
  replacement is required before the user can press Enter to run.
- No hardcoded external URL, no auto-run.

## Consequences

- Real provider seam without vendor lock-in.
- Safe default: no endpoint means no network.
- Browser keys are visible; production should use same-origin proxy/session keys.
- Streaming ghost text and server-side key storage remain follow-ups.

## Acceptance

- [x] Glue tests cover config parsing, request shape, response filtering.
- [x] Playground wires shell-mode `#` ghost suggestions, accept-only execution.
- [x] Backlog/changelogs record shipped scope.
