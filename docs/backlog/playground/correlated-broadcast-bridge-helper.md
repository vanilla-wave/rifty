---
area: playground
status: draft
title: Factor the correlated request/reply-over-BroadcastChannel scaffold into one helper
created: 2026-06-30
why: five hand-rolled copies of the same nextRequestId + pending Map + per-request timeout + dispose-reject correlation engine; a fix to one (timeout-cleanup race, dispose leak) must be applied five times
user_story: As a rifty maintainer touching a cross-realm bridge, I want one tested correlation helper, but today each bridge re-implements the request/reply scaffold so a fix or audit has to be repeated per-port.
sources: []
code: [packages/workbench/src/glue/git-owner-port.ts, packages/workbench/src/glue/workspace-file-read-port.ts, packages/workbench/src/glue/node-modules-port.ts, packages/workbench/src/glue/workspace-archive-port.ts, apps/playground/src/glue/ts-ls-client.ts]
---

## Context

Five page↔owner bridges each hand-roll the same correlated request/reply engine
over a `BroadcastChannel`: a module-level `nextRequestId()`, a
`pending = Map<id, Waiter>`, an `onMessage` that correlates by id +
`clearTimeout` + resolve/reject, a `setTimeout` reject that `pending.delete`s,
and a `dispose()` that rejects all pending + closes the channel. PR #95 added the
4th and 5th copies (`git-owner-port`, `workspace-file-read-port`) on top of three
pre-existing ones (`node-modules-port`, `workspace-archive-port`, `ts-ls-client`;
`@riftydev/net`'s `preview-port` is a 6th near-relative).

All five are currently behaviorally identical (each carries dispose-rejects-all +
clearTimeout-on-resolve + torn-guard), so there is **no functional bug today** —
this is duplication/maintainability debt, not a fidelity violation. A one-sided
future fix (e.g. a teardown leak or timeout-cleanup race correction) would have to
land in five places, and the per-port boilerplate inflates each bridge (~50 lines
of scaffold in a 450-line file).

Deferred deliberately from PR #95: extracting a shared `createCorrelatedBridge`
across five live, message-shaped-differently bridges is a refactor whose
regression risk outweighs the value of fixing a confirmed nit inside that PR.

## Options or Next

- Extract `createCorrelatedBridge<Req, Res>({ channelName, frameFor, idOf })` in a
  playground glue module returning `{ request, dispose }`; migrate the five
  bridges one at a time, each behind its existing unit tests.
- Decide whether `@riftydev/net`'s `preview-port` (lives in a lower package, can't
  import playground glue) shares the helper or stays its own copy — likely stays,
  so the helper is playground-local.

## Out of scope

- Changing any bridge's wire frame shape or public behavior — pure internal
  factoring, every bridge's tests must stay green unchanged.
