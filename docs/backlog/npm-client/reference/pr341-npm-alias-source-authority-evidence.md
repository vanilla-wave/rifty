# PR 341 — retained alias source authority

2026-10-13, baseline ec214f71b, Node v24.16.0/npm 11.17.0. Original npm
archives served over localhost; no Rifty registry. ADR-0527 partially
supersedes ADR-0526 after an independent DEC-2 oracle repeated these cases.

## Native authority

`npm install` after manifest-only changes at a satisfying retained version:

| Before → after under the same key | Native result |
|---|---|
| root-alias npm:string-width4.2.3 → plain4.2.3 | Retain string-width name/archive/SRI; zero HTTP. |
| root-alias npm:is-fullwidth3 → npm:ansi-regex3 | Retain is-fullwidth name/archive/SRI; zero HTTP. |
| is-fullwidth3 plain → npm:ansi-regex3 | Retain original plain package, no lock name field; zero HTTP. |
| Admitted root-alias lock name changed to wrong-target | Retain that name and old archive/SRI; zero metadata HTTP. |

`npm install root-alias@npm:ansi-regex@3.0.0` selects the new target; metadata
without `dist.integrity` still supplies original `dist.shasum`, producing
`sha1-7QMXwyIGT3lGbAKWa922Bas32Zg=`. `npm update root-alias` instead consults
ansi-regex metadata while retaining the old same-version target. Thus
`updateNames` continues ADR-0504's named-install intent, not npm update.

Durable carrier: `tests/integration/npm-alias.parity.test.ts`. Scratch
observations: `/tmp/pr341/alias-edge/alias-edge.test.ts`, `results.log`;
independent decision carrier: `/tmp/pr341/decision-alias-edge`.
Original ansi-regex3 archive: 2264 bytes, SHA-512
`wFUFA5bg5dviipbQQ32yOQhl6gcJaJXiHE7dvR8VYPG97+J/GNC5FKGepKdEDUFeXRzDxPF1X/Btc8L+v7oqIQ==`.

## Root cause / RED

1. Replay rebuilt acquisition identity from the changed manifest's effective
   name; alias→plain lost the target cache key and lock name. Alias target
   drift additionally forced metadata, contradicting npm's no-args retention.
2. Live resolution copied a same-version lock checksum by install key alone,
   even when that lock belonged to a different canonical package. It also
   ignored declared SHA-1 shasum when SRI was absent.

Before product edits, durable `source authority` suite on ec214f71b: RED4.
Two retained cases failed `registry.tarball` / `registry.packument` offline;
two explicit changes copied is-fullwidth's checksum onto ansi-regex and
failed `EINTEGRITY`. Plain→alias additional RED after the first correction
identified the remaining absent-name fallback: it must use the recorded
placement name, not the changed request target.

The earlier wrong-target **repair** assertion was a frozen assumption.
Independent native probe retained that name, including warm-cache/no-tree
replay. It was explicitly superseded by ADR-0527 and replaced with Native
retention parity; explicit source-transition fault rows use natural original
packages and named installation intent. Historical evidence remains history.

## Fix / proof

Retained version keeps lock acquisition name, falling back to placement name
when no lock name exists. Named installation selects metadata through the
existing intent API. Selected SRI wins; otherwise a validated 40-hex SHA-1
shasum owns the bytes. A retained-checksum fallback requires canonical target
and version equality. Ordinary override/shadow frontiers remain active.

Alias suite now14 cases: default retention/offline/cache/LF name and absence,
explicit signed and nohash transitions, exact original compressed archive
cache bytes and every native installed file, malformed shasum before tarball
HTTP, and corrupted real gzip header rejected by both native npm and rifty
before project publication. No mocks of installer/VFS/cache/runtime.

Neighbor gate: installer, lockfile/readers, overrides, SHA-1 lock parity,
fetch/unpack, Eddy producer/roundtrip + alias suite:11 files /274 tests PASS
before the added plain→alias carrier; final gate rerun covers11 files /275
tests, including14 alias cases.

## Revert checks

Run in `/tmp/pr341/alias-revert`, keeping the working source frozen:

- Remove retained lock name propagation: alias→plain offline RED1,
  `registry.tarball` required despite warm verified target cache.
- Restore name-mismatch metadata repair: same-version alias target change
  offline RED1, `registry.packument` for the new target.
- Remove canonical target from checksum fallback: nohash explicit change
  RED1, old is-fullwidth SRI incorrectly applied to ansi-regex bytes.
- Ignore metadata shasum: corruption/malformed checksum fault rows RED2;
  unsigned fallback accepts the invalid inputs instead of honoring SHA-1.
- Remove malformed-shasum validation alone: RED1, archive is fetched before
  a late integrity error instead of rejecting the declaration.
- Infer an absent lock name from the changed request target: plain→alias
  offline RED1, despite a warm verified cache under the retained placement.

Each restored tree runs the durable suite; parent owns committed-tree gate
and independent final review.

## Fault matrix / sibling sweep

Owned graph projection: provenance-lie, poisoned-cache, sibling-drift,
frozen-assumption, lossy-aggregate. Canonical target now comes from the source
that owns bytes; never recomputed from a later request. Live/replay/cache/LF,
Eddy request ownership and bundle completeness share that rule. Explicit
source checksums validate corrupt-input and observable-order before archive
acquisition/publication. Real network body poisoning is exercised against
original archives; transport faults retain existing registry/fetch owners.

No new coordination mechanism. Synchronous shaping excludes transport
loss/duplication/reorder; no writes/shared scheduler in checksum parsing
(torn-state/concurrent-same-key/quota-perm-fail excluded there). Existing
installer/cache write and network fault suites remain required owners.

## Existing generic divergence

Metadata with neither hash: native explicit install writes no LF integrity;
rifty's established default computes/persists SHA-512 for its replay cache.
The carrier compares native target/resolved/archive/files plus an independent
Node digest of original bytes. It does not claim exact unsigned fresh-lock
parity. Recorded in `npm-client/npm-project-metadata` and public compat.
Native signed-lock replay remains the exact path/source claim.
