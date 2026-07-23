---
area: npm-client
status: ready
title: Shadow-substitution registry core — recipe schema, strict codec, manager/store
created: 2026-07-23
why: ADR-0308 needs its substrate — one clone-safe recipe model with OPTIONAL runtime binding, one strict ingress codec, and a manager/store whose boundary to the package-tree authority is frozen as a named contract before the authority slice replaces what sits behind it
epic: honest-shadow-substitutions
sources: [ADR-0308, ADR-0309, ADR-0307, PR-160]
---

## Context

Slice `registry-core` (see epic §Budget). Substrate only: recipe model, codec,
manager/store/ready-only port, export disposition, frozen boundary. Activation
/ adapter dispatch is the `esbuild-vite-cutover` slice; authority internals are
the `package-tree-authority` slice behind the boundary this slice freezes.
Port selectively from the #160 quarry: machinery ADR-0309 marks for deletion
(read-deadline ladders, replay/duplicate ledgers, progress frames, child-side
re-SHA of owner-verified transfers, in-flight join paths, whole-store rehash
per lookup) is NOT ported — never port-then-delete.

## Acceptance

- One clone-safe recipe model (ADR-0308): trigger/version, exact
  materialization + acquisition provenance, OPTIONAL `{adapterId, assets}`.
  An install-only recipe (Sass Pattern 1 shape) yields applied/materialization
  facts and an empty asset plan; runtime-asset planning filters to recipes
  WITH a binding. Catalog data never carries functions.
- One strict ingress codec, applied exactly once at every published or clone
  boundary (planner ingress, lockfile-trace decode, manager `ensure`/reader,
  port server and client construction). RED cases per boundary: forged catalog
  id/digest, substitution or adapter id absent from the builtin catalog,
  tampered descriptor bytes/size/digest, non-canonical ordering, duplicate
  members — each a typed loud rejection. Frozen owner-internal values use
  invariants, not re-decode.
- Lockfile provenance round-trip (ADR-0308): applied-substitution trace +
  materialization provenance written to the lockfile; matching replay
  regenerates byte-identical files with zero registry reads; a lockfile
  carrying a shadow identity but no trace loud-fails with the gap named.
- Manager/store contract (ported from the quarry's proven contract):
  digest-verified CAS; acknowledged object write + read-back before any
  receipt; receipt → ready-pointer publication order; storage-qualified
  readiness classes `opfs-persisted | opfs-best-effort | memory-session` from
  a real boot-time probe, never fabricated. Hot path: each object's bytes are
  SHA-verified once when loaded from storage; no whole-store rehash per
  lookup; retained in-memory verified bytes copy without another SHA.
- Ready-only MessagePort: a child holds a port only after `ready`; ONE
  deadline owner (port client) with downward best-effort cancel; request
  correlation only — no progress frames, no replay/duplicate/order ledgers,
  no server/manager deadline tiers (fault-classes §Boundary failure models).
- The manager↔package-tree-authority boundary is frozen as one named
  interface with a consumer contract test; the authority slice must keep that
  test green unedited.
- Per-root-export disposition executed and enumerated in the PR: zero
  production consumers → deleted; repo-shared primitive → declared
  `/internal` subpath + shared consumer contract suite; any already-published
  behavior change → successor ADR. No unearned public symbol survives.

## Parity cases

Two oracles — the quarry's proven store contract and deterministic vectors;
each case a failing-test-first target:

1. Recipe → materialization → lockfile → replay round-trip: byte-identical
   files, identical trace, zero registry reads on replay.
2. Canonical-JSON digest determinism against fixed vectors; non-canonical
   input rejected, never silently re-canonicalized.
3. Store cold-reopen chain: pointer → receipt → per-object SHA of the actual
   stored bytes; any mismatch → no ready claim, honest re-acquire.
4. Storage-class probe: OPFS persisted / best-effort / unavailable → the three
   readiness classes, each observable.
5. Port read: verified bytes delivered once per request; store cleared
   mid-read → loud typed error, retryable; no silent retry.
6. Old lockfile without `rifty` block and without shadow identity → empty
   plan, standard install unchanged.

## Fault matrix

Tier `production` × boundary rows (§Boundary failure models; struck axes not
represented):

| Boundary × fault | Honest outcome |
|---|---|
| Storage: crash between object write and receipt/pointer publish | cold reopen finds no ready pointer → re-acquire; no partial trust |
| Storage: quota/permission failure mid-persist | readiness degrades to the honest class or loud-fails; no durable claim fabricated |
| Storage: stored bytes fail SHA at load | loud typed error → re-acquire; never serve unverified bytes |
| Network (acquisition): truncated/corrupt/oversize body | bounded read + SRI reject, loud, retryable; no fallback to host bytes |
| MessagePort: peer death / port close mid-read | client deadline settles loud; cleanup on confirmed death |
| MessagePort: owner respawn | new epoch requires fresh admission; old ports settle dead |
| Cross-tab | excluded by the origin-wide Workbench Web Lock (ADR-0309 retained) — no CAS/re-hash machinery |

## Out of scope

- Executable adapter dispatch, activation, any esbuild/Vite recognition —
  `esbuild-vite-cutover` slice.
- Package-tree authority internals — behind the frozen boundary.
- External/third-party catalogs or executable SPI — construction-time trust
  decision per ADR-0308; no public SPI ships here.
- Shadow-specific Eddy asset source — not ported (ADR-0308, measured slower).
- Runtime-asset generalization claims beyond N=1 — withdrawn per ADR-0308.

## Decisions

- ADR-0308 owns the recipe model, codec rule, export-disposition rule, and
  quarry-ADR dispositions.
- ADR-0309 owns which reliability machinery is never ported (this slice) vs
  deleted behind the boundary (authority slice).
- ADR-0307 owns why the store has zero coupling to install-tree trust.
- fault-classes §Boundary failure models owns the struck axes (no
  replay/duplicate/reorder on live ports).
- Boundary interface naming/shape is implementer-owned mechanism; the contract
  constraint: one named interface, one consumer contract test, authority slice
  keeps it green unedited.
