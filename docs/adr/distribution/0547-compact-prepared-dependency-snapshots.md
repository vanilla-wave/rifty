# ADR 0547: Compact prepared dependency snapshots

Status: Accepted
Date: 2026-10

## Context

Prepared no-COI editors build installed dependencies without reinstalling them.
ADR-0346/0386 replay archives add transport bytes unused by that scenario.
Goal compact-dependency-snapshots I1–I3 preserves ordinary replay guarantees.

## Decision

- Public `produceDependencySnapshot({ ..., profile?: 'replay' | 'compact' })`.
  Omitted profile remains replay; unknown values reject before acquisition.
- Compact uses tar manifest version 5 with required `profile: 'compact'`.
  Same payload/identity rules as v4; no `rifty/replay-cache` entries. Internal
  decoded compact snapshots and JSON serialization also use version 5. V3 JSON
  and v4 tar remain replay-only; they cannot carry a compact marker.
- Bake uses the same installer, caller pins, preparation and verified replay
  closure, then omits that closure from transport. No new resolver or installer.
- Shared preflight still validates lock structure, install identity, payload
  paths and prepared files. Compact requires an empty cache; restore/apply skip
  cache import and cache flush entirely. Existing shared entries survive.
- SnapshotId authenticates the complete uncompressed envelope as before.
  V5 is deliberately unsupported by old readers; no ambiguous optional v4 flag.
- No saved-state marker/migration, install prohibition, registry fallback,
  offline reinstall guarantee, reset semantics or added crash atomicity.

## Compatibility evidence

BASE f37bfc517613d0e3618519ccbeeb3ed15fd5cc39: compact contract tests reject v5
with `Unsupported dep snapshot version 5`; v3 with an unknown compact marker
is accepted for a real ms tree. Old tar decoder accepts only manifest v4.
The packed same-input Vite 7.3.6 pair and no-COI journey carry I1–I2.
Existing replay closure/SRI and malformed-container suites retain I3.

## Alternatives

Optional v4 marker: old readers either ignore it or misclassify missing replay.
Remove ordinary replay bytes: violates I3. New installer/persistence owner:
unnecessary; existing tier projection and payload overlay already own application.

## Consequences

Compact reduces the measured Vite pair, not every possible tree. Readers must
upgrade before consuming compact; ordinary producers/readers remain compatible.
Explicit install retains existing cache-miss and replay behavior.
