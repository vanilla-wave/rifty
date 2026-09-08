---
area: distribution
status: draft
title: Bake dependency snapshots through a published producer
created: 2026-09-07
why: A host cannot bake its dependency snapshot in its own CI using only installed rifty packages.
user_story: As the Tracker plugin-sandbox embedder, I want to bake a browsable dependency archive in my own CI, but today a host cannot bake its dependency snapshot in its own CI using only installed rifty packages.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md]
code: [apps/playground/tools/bake-dep-snapshots.ts, packages/workbench/src/glue/dep-snapshot.ts, packages/workbench/src/workbench/public.ts]
---

## Context

The existing bake script imports private Workbench modules and playground
specs. No public producer or current install-artifact identity is exported.
JSON/gzip loading already passes; the missing value is a published producer
and standard tar.gz entries that ordinary archive tools can inspect. Caller package.json + package-lock.json and registry config must
produce the exact supported installed tree, replay cache, a standard tar.gz file archive,
snapshotId and compatible runtime identity without a checkout. A pinned lock
must not silently resolve newer versions. Existing unsupported-package gates
remain visible; this does not introduce lifecycle-script support.

The user explicitly accepts a registry endpoint requiring no authentication
from the builder. Private-registry access is the embedding environment's job;
no npm credential manager, auth script generation or private-package proof is
added to the producer contract.

CLI/public API packaging and exact names are agent-owned ADR choices. Include a
packed-consumer test that bakes caller inputs and restores the result, including
raw tar.gz and HTTP-decoded tar delivery. No private Tracker package is needed
to prove that boundary; do not claim its unavailable closure was validated.

All project-relative data maps under one payload branch; all rifty control data
and replay cache map under a separate envelope branch. Example spelling only:
`payload/package.json`, `payload/package-lock.json`, `payload/node_modules/`,
`rifty/manifest.json`, `rifty/replay-cache/`. A user path `rifty/manifest.json`
would map to `payload/rifty/manifest.json`, never the control entry. Control
entries are never extracted into the project tree. No user filenames are
reserved or silently renamed. Validate canonical entry paths, collisions,
unsupported entry kinds, limits and identity before destination effects.

Keep the legacy v3 JSON/gzip reader and existing replay-cache trust checks.
Archive order/timestamps and identity semantics need a reproducible packaging
contract at pickup; merely having a .tar.gz suffix does not prove interoperability.
The existing npm extractor rejects symlinks and skips some entry types, so it
is evidence to audit, not a ready snapshot reader. Standard tar tooling must
list/extract collision fixtures and the browser must restore matching bytes.

Dedup: representation work from
docs/backlog/playground/snapshot-carries-substituted-bytes-twice.md is assigned
here; that draft retains only the independent tree/cache duplication question.

Scope and user decisions: goal I1. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Acceptance

1. `produceDependencySnapshot` is exported from the packed Workbench root, accepts caller manifest text, npm v3 lock text, templateId and configured registryUrl; emits tar.gz bytes, snapshotId and current install-artifact identity using the existing installer. `dep-snapshot-producer.test.ts` real ms bake. → I1
2. Every emitted ordinary package identity matches its exact caller lock path in version/resolved/integrity; only attested materialization, new fixed acquisition and validated bundled paths may differ. Existing acquisition pins still match. New ordinary root/nested pins fail; current supported native adaptation remains. Real ms/debug/LightningCSS fixtures and Vite8 probe. → I1
3. Shared manifest canonicalization preserves caller JSON values and matches public project definitions. Archive emission is deterministic for identical admitted installed bytes; ordinary tar extracts the actual package bytes. Identities bind decoded tar and the runtime installation recipe. → I1
4. Unsupported/malformed locks, root request mismatch, integrity failures and existing unsupported-package gates fail visibly with no emitted artifact or caller-disk writes. The existing 128 MiB reader limits bound emitted archives. → I1
5. A consumer installed only from packed packages bakes its caller manifest/lock, then public snapshot-backed Workbench restores and executes real ms code through raw gzip and HTTP-decoded tar; browser dependency acquisition cannot substitute a registry install for this proof. `workbench-packed-consumer.mjs` producer journey. → I1

## Fault matrix

- Registry corrupt/missing bytes × bake: integrity/acquisition failure, no artifact. Real tarballs through substituted external HTTP only. → I1
- Incomplete/range-drifted lock × output admission: reject new ordinary output paths, including a nested copy beside a retained hoisted pin. → I1
- Attested registry-source/bundled replay × bake/restore: exact source bytes admitted; retained caller source pins cannot drift. Codec's existing real LightningCSS replay proof is inherited; producer/public packed path adds emission proof. → I1

## Out of scope

Arbitrary installed-tree import, new package compatibility, builder-owned registry
authentication, streaming restore and larger snapshot limits remain excluded by goal.
Public application-policy and registry-free mode follow their own goal units.

## Decisions

- 2026-09-08 — ADR-0387: public root producer, existing installer plus output-pin postcondition; no parallel resolver.

- re-cut: 2026-09-08 — distribution/dep-snapshot-tar owns codec proof first; this unit retains public producer and packed-consumer I1 proof — trace: none

- 2026-09-07 — F1 user decision: builder-owned registry authentication excluded; host environment provides access.

- 2026-09-07 — user: producer-generated tar.gz, ordinary inspection, disjoint user/control paths; arbitrary caller-created installed trees are not admitted.

- 2026-09-07 — finding draft; observable scope is settled by goal I1; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear

### Re-fit — application and registry policies

challenge: 2026-09-07 — clear
