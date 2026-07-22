# ADR 0305: Page-owner correlation substrate settles mutations on owner terminal or owner death

Status: Accepted
Date: 2026-07

> TL;DR: One playground-local request/reply correlation owner replaces the hand-rolled per-port engines; mutations settle ONLY on the owner's terminal or proven owner death/epoch change, reads keep bounded deadlines.

## Context

The page realm hand-rolls the same correlation engine (`nextRequestId` + pending `Map` + per-request timeout + dispose-reject) in ~9 places: five `BroadcastChannel` ports (`git-owner-port`, `workspace-file-read-port`, `node-modules-port`, `workspace-archive-port`, `ts-ls-client`) plus `owner-vfs-client`, `pty-client`, `project-index-port`, `playground-session-tools-transport`. Any fix lands N times (§Class-kill mechanism sweep). Worse, the shared timeout semantics lie on mutation channels: a fired deadline drops the only correlation and reports failure while the owner may still apply — `provenance-lie` at the page boundary (PR-153 post-merge audit). Per `fault-classes.md` §Boundary failure models, the page↔owner boundary cannot lose-then-replay or duplicate; its real faults are slow owner, owner death/port close, and respawn epoch.

## Decision

- One substrate owner in playground glue; per-channel engines are migrated onto it and deleted. `@riftydev/net`'s `preview-port` stays separate (lower layer cannot import glue).
- Two request classes: **read** — deadline-bounded, timeout = honest "unknown, no state changed"; **mutation** — no deadline may assert "not applied": settlement comes only from the owner terminal, or from proven owner death / epoch change (then: outcome unknown, surfaced as such). A local deadline may drive UI (spinner, degraded notice), never a definitive failure.
- Excluded axes (lost-then-replayed, duplicate delivery) get NO machinery — no retention ledgers, no replay, no request-equality dedup.
- Carrier per channel (BroadcastChannel vs MessagePort, death-signal wiring) is implementation territory bounded by this contract — the substrate item spikes it, this ADR does not prescribe it.

## Consequences

- One place to fix correlation bugs; the class is killed instead of point-fixed per port.
- `backlog: playground/correlated-broadcast-bridge-helper` absorbed by `playground/page-owner-correlation-substrate`; `workbench-fault-honesty` terminal-certainty children shrink to per-channel adoption + their RED cases.
- Channels whose transport lacks a death signal must gain one to carry mutations — migration cost, paid per channel at adoption.
- Behavior change on fault paths only (no more false "save failed" before a late apply); green paths stay byte-identical, pinned by unchanged channel contract suites.
