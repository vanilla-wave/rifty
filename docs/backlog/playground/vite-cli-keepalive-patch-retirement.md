---
area: playground
status: ready
title: Retire or classify the Vite CLI keepalive source patch
created: 2026-07-08
why: the Vite CLI wrapper is gone, but `prepareViteCli` still rewrites Vite's installed `dist/node/cli.js` so CAC async actions enter rifty's child-realm keepalive; that byte patch needs an explicit contract or a generic replacement.
user_story: As a developer running `vite`, `vite build`, or `vite preview` in rifty, I want the installed Vite CLI to run without hidden semantic patches except for documented runtime lifecycle glue, but today one source rewrite remains after wrapper retirement.
blocked_by: []
sources: [ADR-0152, ADR-0158, ADR-0174, ADR-0188, ADR-0189]
code: [apps/playground/src/workers/vite-cli-prep.ts, apps/playground/src/workers/node-entry-bootstrap.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

ADR-0174 moved `vite` to the real installed `.bin/vite` CLI. PR #125 removed the
generated config wrapper, all `RIFTY_VITE_CLI_*` gates, AND the preview-CORS
source patch (retired outright — execution-boundary honesty; observable CORS
parity questions live in `playground/vite-preview-cors-middleware-parity`).
`prepareViteCli` applies exactly ONE remaining rewrite to Vite's own
`dist/node/cli.js`: the keepalive patch, replacing CAC's
`this.runMatchedCommand();` call with a tracked promise handoff to
`globalThis.__riftyTrackCliPromise`.

The keepalive patch is not a Vite config/transport policy: it exists because the
child realm must stay alive while Vite's async command action is in flight. Still,
it mutates third-party package bytes and can drift with Vite CLI internals, so it
must be either retired by a generic lifecycle hook or explicitly documented as a
narrow runtime adapter.

## User scenario

A developer installs a Vite version whose CLI uses CAC, runs `vite build` or
`vite preview`, and expects the command action to complete like Node. Rifty must
not exit the child early, and it must not silently skip the command if Vite's CLI
shape changes.

## Acceptance

- RED first: remove the keepalive rewrite and prove the child realm exits too
  early or misses command completion, or prove the current runtime keepalive
  already covers the command action without the patch.
- If a generic replacement exists, delete the Vite-specific source rewrite and
  keep Vite command completion green through the installed CLI path.
- If the rewrite remains, classify it as runtime lifecycle glue in
  `docs/public/compat` or an ADR note, keep the needle guard loud on Vite CLI drift, and make PR
  wording distinguish it from deleted wrapper/config gates.
- No other Vite source rewrite exists or gets added under this item; observable
  preview CORS behavior stays owned by
  `playground/vite-preview-cors-middleware-parity`.

## Parity cases

- Real Node `vite build` and `vite preview` keep the process alive until the
  async CAC action settles.
- Rifty child-realm `vite build` and `vite preview` do the same through the
  installed `.bin/vite` CLI.
- A Vite CLI internal-shape drift fails loudly before command execution instead
  of silently running an untracked async action.

## Out of scope

- `vite preview` CORS/header parity; tracked in
  `playground/vite-preview-cors-middleware-parity`.
- Reintroducing a generated Vite config wrapper or `RIFTY_VITE_CLI_*` env gates.
- Arbitrary package-byte patching as a general mechanism; this item covers the
  single CAC keepalive patch.

## Decisions

- The default target is deletion via a generic child-realm lifecycle hook. If no
  generic hook can observe the CAC action, retaining the patch is allowed only as
  a documented, needle-guarded runtime lifecycle adapter.
- The patch must never change Vite config, CLI args, HMR transport, or user
  source semantics.
