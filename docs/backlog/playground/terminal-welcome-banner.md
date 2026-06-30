---
area: playground
status: ready
title: Terminal welcome banner — version + "try this" before the first prompt
created: 2026-06-30
why: on first load the terminal shows only a bare grey `> ` with no banner, version line, or hint — the first thing every announcement visitor sees gives zero direction and wastes the poke window.
user_story: As a first-timer who just landed, I want the terminal to tell me it's real Node and suggest a first move, but today `mount()` only writes the prompt and there is no welcome string anywhere in the playground.
epic: frictionless-first-poke
blocked_by: []
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [packages/terminal/src/terminal.ts, apps/playground/src/glue/pty-protocol.ts]
---

## Context

`terminal.mount()` (`terminal.ts:646`) calls only `writePrompt()` → the bare grey `PROMPT` (`terminal.ts:29`). No banner/version/hint; the onboarding README is a file, not opened by default. The greeting CONTENT (version + hints) is a playground onboarding concern; `packages/terminal` should stay content-agnostic via an optional banner on mount.

## Acceptance

- On first terminal mount, an ANSI-dim banner prints once BEFORE the first prompt:
  - line 1: `rifty · node v24.0.0 · npm in your browser` (version from the live `process.version`)
  - line 2 (dim): `try:  node -v   ·   npm install chalk   ·   help`
- The banner prints once per session — NOT on every prompt or after `clear`; a fresh terminal / reset reprints it.
- Content is supplied by the playground via a `banner?: string` option on the terminal mount; `packages/terminal` adds the option but ships no copy of its own.
- The banner scrolls away as ordinary output and causes no layout shift.

## Parity cases

None — terminal onboarding UX. Verification = an e2e asserting the two banner lines appear above the first prompt on a cold load, and do NOT reappear after `clear`.

## Out of scope

- An interactive tour / coachmarks; auto-opening the README; localization.
- Wording that claims full Node compatibility (Fidelity: the banner must stay honest).

## Decisions

- Banner copy is final (the two lines above) and version-interpolated, so it can't over-claim.
- `packages/terminal` exposes a content-agnostic `banner?` option; the playground owns the string.
- REVERSIBLE (UX, no public API) → CHANGELOG in apps/playground (+ packages/terminal); no ADR.
