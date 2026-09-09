# ADR 0408: Public Workbench duration budgets use existing deadline owners

Status: Accepted
Date: 2026-09
Refines: ADR-0360, ADR-0359

> TL;DR: Three optional positive-finite `deployment` duration budgets
> (`ownerStartupTimeoutMs`, `projectFileTimeoutMs`,
> `sessionToolsTimeoutMs`) thread into the existing ready/proof/commit/
> session-tools deadlines; omitted keeps today's 30 s / 60 s owners;
> ADR-0360 silence stays a separate public budget.

## Context

Goal self-hosted-snapshot-workbench I7. ADR-0360 already exposes
`ownerOperationSilenceTimeoutMs` (silence, not total duration). Hidden
total-duration siblings still cut a host-selected wait: owner ready and
close/exit observe at 30 s, OPFS proof at 30 s, project VFS commit at
60 s, Playground session-tools SCM/archive/durability-flush requests at
60 s. Raising silence does not move those timers. Packed `/sandbox/`
composition of the whole scenario stays this unit's closing acceptance.

## Decision

Public Workbench options (absent when omitted — each owner keeps the one
shipped default):

```ts
deployment: {
  ownerStartupTimeoutMs?: number;  // default 30_000
  projectFileTimeoutMs?: number;   // default 60_000
  sessionToolsTimeoutMs?: number;  // default 60_000
}
```

Positive finite, same `TypeError` / `deployment.<name>` authority as
`previewProbeTimeoutMs`. Invalid values fail before owner start / SW
register.

`ownerStartupTimeoutMs` is the effective budget for page-side owner
ready and close/exit observe, and for worker-side OPFS proof (additive
optional on the existing initialize deployment). Those three sites share
today's 30 s constant or default; one public number, no fourth owner.

`projectFileTimeoutMs` is the page-side VFS commit/durability budget
(`commitTimeoutMs`).

`sessionToolsTimeoutMs` is the page-side Playground session-tools
request budget (SCM, archive, durability flush). Catalog create/list
owner RPCs stay ADR-0360 silence — they have no hidden total-duration
sibling. TypeScript `tsRequestTimeoutMs` does not change.

A deadline never proves an admitted mutation did not apply. No new
timeout/retry coordinator. No hidden retries.

Candidates: three duration knobs matching I7/scenario groups (selected).
One mega-timeout (killed: mixes 30 s/60 s defaults and silence vs
duration). Export every timer (killed: draft; preview probe and silence
already public; TS responsiveness is out of I7). Two knobs boot-vs-ops
(killed: scenario names file and catalog/SCM/archive separately).

## Consequences

A host can raise slow boot, file commit, or session-tools waits without
a dist patch, and a longer public budget is the timer those paths use.
Silence remains independently configurable. Packed-host composition
proves the whole goal scenario after these knobs land.
