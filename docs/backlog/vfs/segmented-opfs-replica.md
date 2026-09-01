---
area: vfs
status: draft
title: OPFS replica format for fast first open and reopen
created: 2026-08-31
why: per-file OPFS persistence takes 7.18 s and eager reopen 4.91 s on a 98.2 MB / 14,492-file tree; a traced validated mini-journal measured 1.15 s append and 1.08 s read+replay
user_story: As an SDK embedder opening and reopening a project with a baked 98.2 MB dependency snapshot, I want the multi-second storage wait reduced without weakening reload honesty.
sources: ["issues #255/#256", ADR-0072, ADR-0358, docs/backlog/vfs/reference/storage-journal-design-benchmarks-2026-08-31.md, docs/backlog/vfs/reference/storage-open-reopen-candidate-benchmarks-2026-09-01.md]
code: [packages/vfs/src/opfs-sync.ts, packages/vfs/src/opfs.ts, packages/vfs/src/opfs-drain-scheduler.ts, packages/workbench/src/glue/install-stamp.ts, packages/workbench/src/glue/install-stamp-authority.ts]
---

## Context

Chromium evidence on a real-path 14,492-file / exact 98.2 MB surrogate:
current per-file drain median 7.18 s; reopen 4.91 s (walk 2.14 s, preload
2.73 s, owner assignment 20 ms). A disposable content-addressed segment spike
replayed the real 16,502-op drain trace: 1.15 s append at 85.5 MB/s and 1.08 s
validated read+replay. The ≥50 MB/s design gate passes; owner assignment is not
the ceiling. Evidence conditions and samples are in the reference doc.

Issue #256's end-to-end owner probe places the durability flush inside
`openProject`: 40.4 s of a 42 s first materialization before `createProject`.
ADR-0358 changed the drain mechanism; this session remeasured that same
flush-shaped boundary at 7.18 s. The spike therefore proves a storage-boundary
gain, not a one-second end-to-end readiness claim.

This is a new persistence authority/format, so implementation needs an ADR with
radically different candidates and migration/fault evidence. The spike is
carrier evidence, not that decision.

The ADR comparison must include at least: (A) traced segmented CAS replay;
(B) per-file content retained, but a durable logical index/metadata snapshot
removes the 2.14 s walk and lazy hydration removes the 2.73 s preload; (C)
ephemeral + lazy hydration. Candidate B is now measured: its index is cheap
(1.48 MB, 11 ms warm / 31 ms fresh-process load), but a cached-dir lazy burst
takes 4.42 s versus today's 2.73 s preload. The sync-compatible path must
pre-open all 14,492 Promise-valued access handles and takes 4.21 s total.
Candidate A separately targets the 7.18 s first persist and replays the full
tree in 1.14 s fresh-process. Index + cached lazy burst totals ~4.45 s, only
~0.15 s below current fresh-process reopen + eager preload.

Fresh-process measurement did not reverse the prior result: current reopen
4.60 s, journal 1.14 s. Plain deferred promotion is not a cheaper replacement:
it can move the reply, but an immediate `node -e` fails because package-tree
readiness is published only after the trusted stamp. Making that early session
executable needs a new pending-ready contract; fetch/prepare/project setup
also remains and owner death in the window takes the cold restore path.

Constraints already derived from current durability behavior:

- persist-failure ledger stays logical-path granular; every segment records
  its full affected path list;
- install stamp remains independently writable/removable inside the attested
  subtree; `package-lock.json` remains independently readable;
- replay hydrates the complete logical index, including children sets;
- mtime is persisted in the replica; format reserves symlink, hardlink, mode;
- content addressing leaves a route to cross-project dedup without requiring
  it now.

Sibling/overlap: `vfs/opfs-lazy-content-preload` can remove some eager byte
preload but not the measured 2.14 s tree walk or 7.18 s first persist.
`perf/reference/dependency-store-and-vfs-links.md` targets install reuse and
cross-project sharing, not the per-project reload format; keep its COW
constraint if the designs later meet.

Mechanism sweep (`fault-classes.md` §Class-kill): existing state owners are
`OpfsFsSync.persistFailures` (path durability), `OpfsDrainScheduler` (ordering),
`OwnerVfsAppliedJournal` (page publication), project migration journal
(one-shot layout adoption), and content-addressed npm/eddy caches. The replica
must replace per-file persistence under the existing ledger/scheduler
contracts, not add a second writer, failure ledger, or publication journal.

Storage boundary rows to settle before ready: torn/truncated segment and commit
point; corrupt frame/index; quota/permission mid-append; same-origin cross-tab
writers; provenance of content-addressed blocks; exact path-list identity
(`lossy-aggregate`); compaction crash; legacy per-file migration. Actual Tracker
trace remains missing; fresh browser process reopen is measured, but OS cache
eviction was unavailable.

## Challenge

challenge: 2026-08-31 — 1 problem
- Combined scope lacks cheaper-route evidence: per-file OPFS + durable index + lazy hydration could remove 4.87 s of the measured 4.91 s reopen cost without a new authority but remains unmeasured; segmented CAS is only uniquely evidenced for the 7.18 s first-persist boundary, so its migration, compaction, cross-tab, and provenance complexity is not yet justified against whole open-and-reopen UX.

Answer: 2026-09-01 — candidate B measured and fails its decisive burst gate:
4.42 s lazy first-touch versus 2.73 s current preload (+1.70 s, allowed
~0.5 s); its only mechanism-free sync path pre-opens every handle. Journal
fresh-process read+replay is 1.14 s and also removes the 7.18 s first-persist
tail. Plain deferred promotion returns a non-executable session until the
trusted stamp. Cheaper-route challenge closed; journal complexity still needs
the fault and migration evidence above before ADR/ready.
