---
area: distribution
status: ready
title: Workbench install stamp v4 — exact lockfile-byte trust
created: 2026-07-17
why: a v3 trusted tree attests the manifest and installer policy but not the exact package-lock.json bytes from which runtime-asset requirements will be planned
user_story: As a Workbench user reopening a Vite project, I want reuse to trust only the exact installed lockfile bytes, so an edited or replaced lockfile runs real package acquisition instead of admitting stale runtime requirements
epic: honest-shadow-substitutions
blocked_by: []
sources: [docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md, docs/adr/playground/0261-root-bound-serialized-install-trust-claims-and-non-transferable-claim-ingress.md, docs/adr/npm-client/0283-canonical-package-manifest-serialization.md]
code: [apps/playground/src/glue/install-stamp.ts, apps/playground/src/glue/install-stamp-authority.ts, apps/playground/src/glue/install-prefetch.ts, apps/playground/src/glue/package-mutation-executor.ts, apps/playground/src/workers/package-acquisition-authority.ts, apps/playground/src/workers/owner-package-state.ts]
---

## Context

The current owner-local install claim is schema v3. It binds canonical root,
slug, exact `package.json` text, package count, and install-artifact identity,
but a semantically or byte-different `package-lock.json` can remain under the
same trusted claim. Runtime-asset planning must never derive a required set from
lockfile bytes that the installed-tree claim did not attest.

This item changes only install-claim identity, checking, promotion, prefetch
gating, and package-mutation classification. `InstallStampAuthority` remains
the sole claim state owner and `PackageAcquisitionAuthority` remains the sole
serializer of package mutations. Runtime-asset ensure, post-tree asset failure,
tree-readiness epochs, child admission, and deployment cutover belong to later
items.

## Contract

### Schema and construction

- `InstallStamp.version` advances from `3` to `4`. Schema v4 retains every v3
  field and adds required `lockfileSha256`, exactly 64 lowercase hexadecimal
  digits over the exact stored `<root>/package-lock.json` bytes. It has no
  prefix and is not a digest of parsed or reserialized JSON.
- Every on-disk v4 marker, pending or trusted, has a valid
  `lockfileSha256`. When an exact lockfile cannot be read, the authority may
  retain its pending state in memory or durably remove the prior marker, but it
  must not write an incomplete v4 marker.
- One parser and one constructor own the async/sync shape. Extra fields,
  malformed hashes, non-canonical roots, wrong roots, v1-v3, corrupt JSON,
  missing lockfiles, and missing trees are misses; none is migrated or trusted
  in place.
- Generated manifest writers continue to use npm-client
  `serializePackageJson`. User-supplied manifest bytes stay byte-exact and are
  never silently canonicalized. No second manifest serializer or synchronous
  SHA implementation is introduced.

### Async check and promotion

- `InstallStampAuthority.check()` is the only trust gate. In the root-local
  serialized authority it re-reads exact current `package.json` and
  `package-lock.json` bytes, hashes the latter with browser WebCrypto, verifies
  the canonical root/slug/tree/request/artifact identity and expected manifest
  coverage, then compares `lockfileSha256`. Any read/hash/identity mismatch is
  `absent`, never a degraded trusted result.
- `promote()` accepts only the current root/slug/epoch. After the existing
  guarded-tree durability proof, its final serialized commit slot re-reads the
  exact manifest and lockfile, computes the lockfile digest, rechecks epoch,
  tree, and pending marker, and writes trusted v4 last. A lockfile change while
  proof or hashing is parked refuses promotion as identity drift; it never
  publishes the digest of an earlier read over later bytes.
- Demote, revoke, pending-first durability, root binding, reserved marker
  ingress, background promotion, and refusal/error ordering remain those of
  ADR-0261. A prior v1-v3 marker behaves as no trusted marker and real arrival
  mints v4 only after the ordinary proof.
- `installArtifactIdentity` continues to cover installed JS/shims/runtime
  policy and excludes descriptor-only runtime-asset pins. Lockfile-byte trust
  and runtime-asset required-set identity remain separate dimensions.

### Synchronous prefetch gate

- `InstallStampAuthority.checkSync()` never returns `trusted` for an on-disk
  v4 marker because browser WebCrypto cannot prove its lockfile hash
  synchronously. For an otherwise plausible v4 it returns `absent` without
  changing an `unknown` or previously `trusted` in-memory phase to `absent`.
  Existing live `pending` fencing still wins and returns `pending` for its
  matching slug.
- `OwnerPackageState.primePrefetch()` treats that conservative result as a
  miss. A redundant bounded warm Eddy prefetch is accepted; later async
  `check()` may prove reuse and leave the prefetched result unused. Prefetch
  completion, learned pins, or cached bytes can never upgrade stamp trust.
- Removing the redundant prefetch is a later optional optimization, not this
  item's DoD. It must not be solved by copying/exporting synchronous SHA.

### Package mutation classification

- Rename the shared impact union to `none | package-only | tree`. Exact
  `<root>/package.json` and `<root>/package-lock.json` mutations are
  `package-only`: they durably demote v4 through the existing package FIFO but
  do not claim that `node_modules` changed.
- A mutation of `node_modules`, a replacement/removal of an ancestor that can
  touch package metadata or the installed tree, or a combined mutation that
  contains any tree impact is `tree` and retains the existing revoke/tree
  transition. Unrelated project paths are `none`.
- The single classifier is used by every owner mutation ingress. Writers are:
  npm install/finalization and snapshot restore; project reset/switch/seed;
  host file and document commits; terminal/runtime fs; SCM/archive restore; and
  direct Playground project tools. All enter `PackageAcquisitionAuthority`;
  no caller performs an independent stamp transition or reconstructs impact.
- A validated no-op or failure before its first write preserves the prior
  claim. Once a package-only write is admitted, v4 stays demoted even if later
  mutation work fails; a future async acquisition is the only path back to
  trusted.

## Acceptance

### Contract + RED

- First commit adds failing v4 schema/parser, exact-byte async-check,
  promotion-race, conservative-sync, and mutation-classifier tests. The same
  cases run through Memory VFS and SyncMirror/OPFS-backed authority contracts;
  no implementation change is included in the RED checkpoint.
- RED proves v3 currently survives lockfile drift, sync check can report trust
  it cannot prove, and exact `package-lock.json` ingress is not classified as
  package-only.

### Final + GREEN

- Implement the contract through the existing stamp and acquisition
  interfaces. Delete superseded v3-only assertions; do not retain a v3 reader,
  migration path, or dual trust mode.
- `pnpm vitest run apps/playground/src/glue/install-stamp.test.ts apps/playground/src/glue/install-stamp-authority.test.ts apps/playground/src/glue/install-stamp-authority.fault.test.ts apps/playground/src/glue/install-prefetch.test.ts apps/playground/src/glue/package-mutation-executor.test.ts` passes with every RED case green.
- One committed SHA passes `pnpm pr:check`; Final+GREEN review has zero
  correctness blockers.

## Observable proof

1. Mint a v4 claim, close/recreate the authority, and asynchronously reopen the
   same root: unchanged exact lockfile bytes return trusted; a one-byte
   whitespace change with identical parsed JSON returns absent and runs real
   acquisition.
2. Put a valid v3 marker over an otherwise matching tree. Both cold async
   reopen and trusted-reuse acceptance miss; successful acquisition replaces
   it with v4 carrying the SHA-256 of bytes read back from disk.
3. On warm owner boot, `checkSync()` conservatively misses and may start one
   bounded Eddy prefetch. The later async check can still return trusted;
   neither the prefetch nor its result changes authority phase.
4. Exact package.json-only and package-lock.json-only writes demote v4 without
   a tree revoke. A node_modules or root replacement takes the tree path. A
   preflight no-op leaves the prior trusted marker byte-identical.

## Parity cases

1. The v4 marker is private Rifty metadata: successful `npm install` keeps the
   same manifest, lockfile, installed tree, command output, and exit semantics
   as the current real-install path; only later reuse eligibility changes.
2. Editing `package-lock.json` remains an ordinary Node-visible file write.
   Rifty preserves the caller's exact bytes and invalidates private reuse
   metadata; it never rewrites the file to make the claim pass.
3. Legacy/corrupt claims are invisible to the program and fall through to the
   same real package-acquisition behavior as an absent claim, never to a fake
   successful reuse.

## Fault matrix

`InstallStampAuthority` is the single writer of the reserved marker and the
single root-local epoch/phase owner. `PackageAcquisitionAuthority` serializes
all package/lock/tree writers named above before they invoke it.

| Axis | Fault | Required outcome |
| --- | --- | --- |
| `lossy-aggregate` | lockfile changes bytes while parsed dependencies/count stay equal | exact digest mismatch; async check is absent |
| `corrupt-input` | v4 has missing/uppercase/short hash, extra keys, malformed JSON, or wrong root | parser returns miss; no partial trust or migration |
| `torn-state` | promotion hashes one lockfile, then bytes change before trusted publication | final serialized re-read/refusal; no trusted mixed identity |
| `torn-state` | lockfile read/hash or trusted-marker write fails | pending/absent remains; real acquisition on next check |
| `concurrent-same-key` | old promotion races demote/revoke/new epoch | newer epoch wins; old promoter is stale/refused |
| `quota-perm-fail` | demote or promotion durability cannot be proven | prior-safe restore or loud authority refusal per ADR-0261; never false v4 |
| `false-fallback` | sync boot cannot compute SHA | conservative absent only; async check remains sole trust gate |
| `sibling-drift` | async/sync readers or parser/constructor disagree on v4 | shared contract; sync never reports unproved trusted |
| `sibling-drift` | one package-lock writer bypasses package impact classification | one shared executor/classifier; fault test for every writer class |
| `observable-order` | package-only preflight fails/no-ops before write | prior claim preserved; admitted write demotes before mutation |

## Out of scope

- Full `node_modules` content hashing or corruption repair remains the explicit
  `playground/install-stamp-invalidation` gap. No partial spot-check is added;
  any proposed automatic repair must remain compat ❌ until that item is
  refined, never return trusted from a sample.
- Runtime-asset planning/ensure, typed post-tree `ESHADOWASSET` finalization,
  readiness epochs, and child admission are not implemented here. Existing
  package acquisition behavior remains; no placeholder receipt or ready state
  is emitted.
- Eliminating redundant warm Eddy prefetch is not implemented. A synchronous
  SHA adapter is unsupported and must loud-throw
  `NotImplementedError('install-stamp.lockfileSha256Sync')` if requested.

## Decisions

- ADR-0249/0261 fix schema v4 and exact stored lockfile-byte SHA-256; this item
  does not reopen schema, hash, or legacy migration choices.
- Async WebCrypto is the sole trust proof. Sync prefetch gating chooses a safe
  false miss over a false hit.
- Package metadata edits and installed-tree edits share one classifier but have
  distinct `package-only` and `tree` outcomes.
- The claim remains one root-local serialized authority; no second lock,
  generation, recheck owner, or caller-owned digest is added.
