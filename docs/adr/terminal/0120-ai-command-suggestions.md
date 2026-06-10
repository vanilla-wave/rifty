# ADR 0120: AI command suggestions

Status: Accepted
Date: 2026-06-10

> TL;DR: opt-in ghost command suggestions; never auto-run.

## Context

UX backlog asks for command suggestions, but browser-side LLM calls expose keys,
latency, and safety risks. The terminal can show ghost text; policy belongs to
the host.

## Options considered

- No AI seam: safest, misses backlog.
- Built-in provider/client in terminal: convenient, couples terminal to network.
- Chosen: host-owned provider with explicit env opt-in and never-auto-run UI.

## Decision

- Add `ghostSuggestion(state, signal)` terminal seam.
- Playground reads opt-in endpoint/key config and sends command context.
- Suggestions are displayed as ghost replacements only; Enter still submits the
  user's explicit line.
- Restrict prompt context to cwd/mode/core command names; no filesystem upload.

## Consequences

- AI is optional and host-owned.
- Browser-visible keys remain a demo/development trade-off, not production auth.

## Acceptance

- [x] Ghost suggestion cancellation/application tests.
- [x] Playground provider tests.
