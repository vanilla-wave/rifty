---
area: vfs
status: ready
title: Confine Workbench storage to a host-selected OPFS namespace
created: 2026-09-07
why: Workbench currently preloads the whole origin OPFS, including unrelated host files.
user_story: As the Tracker plugin-sandbox embedder, I want to confine workbench storage to a host-selected opfs namespace, but today workbench currently preloads the whole origin OPFS, including unrelated host files.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, ADR-0402, ADR-0279, ADR-0072]
code: [packages/vfs/src/sync-mirror.ts, packages/vfs/src/opfs-sync.ts, packages/vfs/src/opfs.ts, packages/workbench/src/workers/workbench-owner-storage.ts]
---

## Context

installOpfsFs binds both async and sync surfaces to the origin root; init
indexes/preloads every file. Add an opt-in Workbench storage namespace bounding
both reads and writes, including package caches, proof files and recovery state.
The user chose an empty newly selected namespace, no automatic migration; the
previous setting continues to expose previous projects. Reopening a namespace
must preserve its own existing contents rather than clearing it again.

Keep current default behavior for existing callers. This is storage addressing,
not a hostile-code security boundary or permission to run multiple owners.
Use real browser OPFS with unrelated host-file sentinels and two sequential
namespaces; preserve paired-surface coherence and the existing origin lease.
Invalid root selection must fail before effects; ADR owns path validation and
wiring. New namespace setup/reopen failures must not change other namespaces.

Scope and user decisions: goal I4. Baseline/dedup and executed evidence:
docs/backlog/distribution/reference/embedder-gaps-evidence.md.

## Reference contract

Goal I4 and the recorded empty-new-root/preserved-old-setting answers own this
host policy. ADR-0402 defines literal namespace and captured-handle APIs; native
Chromium OPFS supplies the storage behavior, not a POSIX/Node mount approximation.
Research and executed command/version/artifacts:
reference/workbench-storage-namespace-evidence.md. No new transport, lease,
transaction registry or maximum-project-size promise.

## Acceptance

1. Both public Workbench entrypoints accept optional literal storage.namespace; omission/undefined preserves the old origin-root setting. The selected value crosses the existing owner wire unchanged. Invalid syntax rejects before Worker/Web Lock/SW/storage effects for every persistence policy. → I4, ADR-0402
2. The existing OPFS pair uses one selected native root for indexing/preload, sync/async reads and writes, directory operations, cache, claims and storage-proof paths. Guest/project paths and definition identities remain logical and unchanged. Conflicting async-VFS re-init rejects; no live remount. → I4, ADR-0402, ADR-0072
3. A previously absent namespace starts without old user projects; reopening an existing selection preserves its data. Real A/B/default switches retain independent same-id projects and binary/source bytes; unrelated origin files are neither preloaded by a scoped pair nor changed. → I4, scenario5
4. Valid ephemeral mode creates no OPFS namespace. Existing namespace entry-file conflict and OPFS open/proof failures preserve data and required rejection/preferred visible memory fallback. No failed boot recursively deletes its selected root or touches another selection. → I4, ADR-0402
5. One origin-wide lease still excludes concurrent Workbenches even with distinct persistent namespaces; closing/crashing the prior owner permits the next real owner. → I4, ADR-0263
6. Real persistent namespace writes acknowledged durable survive page/Worker death and fresh reopen; existing catalog/claim recovery remains scoped to the chosen root. Default and other namespaces remain exact. → I4, ADR-0279, ADR-0358
7. Mandatory packed public consumer copies published assets, opens independent persistent snapshot-backed projects in A/B, reopens A and the original default project with exact saved bytes and real Node output; registry/Eddy egress stays zero under the accepted I3 mode. → I1, I2, I3, I4, scenario5

## Parity cases

1. Actual native Chromium OPFS retains separate A/B/default entries and byte-exact data; paired VFS observations and public reopen agree with those physical entries. This is browser storage policy, not a claim of Node filesystem mounting. → I4, ADR-0072

## Fault matrix

| axis × operation | honest outcome / carrier | trace |
|---|---|---|
| corrupt-input × namespace ingress | no normalization/escape; reject before real public effects, and at owner wire | → I4, ADR-0402 |
| sibling-drift × paired root | both surfaces and proof/cache/claim paths use selected handle; native outside-sentinel and A/B/default carriers | → I4, ADR-0072 |
| provenance-lie × changed selection/re-init | old files stay at old mount; conflicting init cannot report a different root selected | → I4, ADR-0402 |
| quota-perm-fail × namespace open/proof | required refusal or preferred visible memory fallback; selected entry and other roots retained | → I4, ADR-0402 |
| concurrent-same-key × A/B owner open | global real Web Lock rejects second owner before Worker construction | → I4, ADR-0263 |
| torn-state × durable write then owner/page death | fresh same-namespace owner restores real acknowledged bytes; other selections untouched | → I4, ADR-0279, ADR-0358 |

## Out of scope

Automatic migration/clearing, concurrent Workbench owners, new physical-root
identity in projects/stamps, live remount, public raw filesystem handles,
host-owned storage outside Workbench. Orphan retention/download and the captured
unreadable-cache honesty repair remain linked I6; preview prefix and budgets
remain I5/I7. Existing storage/claim transaction semantics are not replaced.

## Decisions

- 2026-09-09 — pickup: ADR-0402 chooses a literal optional namespace and one native handle at the existing pair; default storage, owner/lease and logical identities remain.

- 2026-09-07 — finding draft; observable scope is settled by goal I4; carrier choices and Contract+RED remain at pickup.
- 2026-09-07 — inherit the goal's production fault tier for this boundary; use docs/process/rules/fault-classes.md and existing owners before adding coordination.

## Challenge

challenge: 2026-09-07 — clear
