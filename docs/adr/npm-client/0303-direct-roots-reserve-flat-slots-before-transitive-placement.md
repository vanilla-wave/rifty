# ADR 0303: Direct roots reserve flat slots before transitive placement

Status: Accepted
Date: 2026-07-21

> TL;DR: surviving direct requests reserve compatible root-visible identities
> before a serial first-wins descendant DFS; skippable optional failures reserve nothing

## Context

ADR-0042's root-by-root DFS lets an earlier root's transitive dependency claim
`node_modules/<name>` before a later direct request for the same name. The
direct package then nests under the empty project parent, producing an invalid
`/node_modules/<name>` path. Node requires direct dependencies to remain visible
from the project root regardless of declaration order.

Mixed ADR-0023 replay adds a second constraint: a retained transitive may own
the old flat slot, but a new direct identity must displace it together with its
recorded descendants. ADR-0175 still requires network completion order to have
no placement authority. Optional direct requests cannot reserve until their
acquisition and archive materialization succeed.

## Decision

- Resolve every required direct request first. Resolve, acquire, and materialize
  every optional direct request. Ordinary optional resolve/acquire/archive
  failures warn and contribute no reservation; structural lock/path errors stay loud.
- Reserve `node_modules/<effectiveName>` for every surviving direct identity.
  Same version+materialization dedupes. Incompatible identities throw
  `EINSTALLPATHCONFLICT` before tree mutation, independent of object order.
- Then traverse roots and descendants serially. Direct reservations outrank
  descendants; among descendants ADR-0042 first-wins-flat and nest-on-conflict
  remains request-ordered. Prefetch and tarball completion never place packages.
- A retained preferred path is used when free. Collision relocates that pin by
  the same rule; recorded-to-actual prefix translation rebases its descendants.
- Demand per install path is monotonic: a later required edge promotes an
  optional scheduled acquisition. Optional acquisition/materialization failure
  cannot suppress a required edge. All started package acquisitions settle
  before a traversal failure is published; packument prefetch follows ADR-0175.

Rejected: keep root-by-root DFS; reserve names before resolving identities;
move already-walked subtrees; implement full npm hoisting in this correction.

## Consequences

- Direct slot ownership and placement are declaration-order invariant and never
  escape the project-relative tree.
- Descendant diamond layout and bounded concurrency remain unchanged; full npm
  highest-possible hoisting remains outside this decision.
- Required root metadata may be resolved before an earlier root later fails.
  Optional roots pay acquisition/materialization before descendant traversal.

Acceptance: both direct declaration orders, same-identity dedupe, incompatible
direct collision, optional acquisition/archive failure, retained relocation +
descendant rebase, optional-to-required promotion, and unchanged Express diamond.

Corrects the root-order clause of ADR-0042 and the global request-order wording
of ADR-0175. Cites ADR-0023 (per-edge replay) and ADR-0042 (descendant placement).
