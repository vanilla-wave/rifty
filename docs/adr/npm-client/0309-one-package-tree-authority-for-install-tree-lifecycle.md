# ADR 0309: One package-tree authority for install-tree lifecycle

Status: Accepted
Date: 2026-07

> TL;DR: package FIFO, install-claim commit protocol, readiness publication,
> and child reservation consolidate into one deep package-tree authority with a
> small operation interface; with ADR-0307 in force it owns NO tree-epoch
> surveillance, and shallow pass-through fragments do not survive it.

## Context

The #160 quarry split installed-tree lifecycle across owners: claim epoch in
the install-stamp authority, tree facts/epoch in Workbench readiness
publication, admission rereads in child bootstrap, plus callback-shaped
fragments (`PackageRuntimeAssetPort`, duplicate readiness unions,
sequence/token compensators). The split produced the series' one confirmed
correctness blocker: nested-cwd `npm install` desynchronized a global
package-tree epoch in the production owner composition while the pinned test
exercised a bare authority. fault-classes §Class-kill names this exact
design-stop: more than two coordination mechanisms guarding one key means the
invariant has no owner.

Quarry ADR-0249/0304 (store + attested tree facts with epoch/readiness split)
never merged; ADR-0307 re-scoped the trust oracle so most tree-epoch
surveillance has no reason to exist.

## Decision

- One package-tree authority owns the complete installed-tree transition per
  root: package FIFO, the ADR-0261/0307 claim commit protocol
  (demote → mutate → flush → promote), readiness publication, and child
  reservation across readiness → synchronous spawn → supervision. A local
  timeout must not release a reservation without commit or confirmed
  terminate/exit/port death.
- It exposes a small operation interface; consumers (installer, snapshot
  restore, manifest edit, reset, bootstrap, adapter admission) call operations,
  never observe internal state. Callback and pass-through fragments
  (`PackageRuntimeAssetPort`-shaped facades) are absorbed, not kept as shallow
  modules.
- No tree-epoch surveillance: with ADR-0307, epochs exist only inside the claim
  commit protocol as promoter fences. Whether facts are per install root or
  composed by ancestry is decided by the authority slice's Contract+RED against
  the PRODUCTION owner composition — covering `cd sub && npm install` with
  exact Node package-tree ancestry, trusted/snapshot/fresh/post-failure paths,
  mutation during readiness, close during install, reservation commit/abort,
  confirmed child termination, and the bare-authority vs production-owner
  sibling sweep (the class the quarry blocker exposed). Moving the quarry's
  single active-project epoch without this observable contract is not a fix.
- Retained unchanged: storage trust chain (receipt/pointer decode, acknowledged
  write + read-back, SHA of actual bytes read from storage), the origin-wide
  Workbench Web Lock (no CAS reopening), and ADR-0261 reserved-claim ingress.

## Consequences

- (+) Kills the nested-cwd global-epoch failure class structurally instead of
  point-fixing it.
- (+) The reliability deletion pass gets its owner: read deadlines, replay
  ledgers, double SHA framing, post-ensure rereads, and split-ownership
  compensators are deleted or absorbed once the Contract+RED proves them
  unreachable or redundant.
- (−) The authority slice must replace implementations BEHIND the frozen
  manager↔authority interface contract from the registry-core slice, keeping
  that slice's contract tests green unedited.
- Follow-up: the authority slice carries the fault matrix rows for
  tier `production` × MessagePort/Storage boundary models (no invented
  replay/duplicate faults on live ports).
