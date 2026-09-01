---
kind: epic
status: ready
title: Project open/reopen at Tracker scale — storage wait in seconds, honesty intact
created: 2026-09-01
value: Opening or reloading a Tracker-scale project (216 packages / 15.6k files / 74 MB) waits ≤2 s at the storage boundary instead of a projected 7.7 s drain inside a real 16.3 s cold open and a projected 5 s reopen, every editor read scales with the entry it asks for, and reload honesty is exactly today's.
user_story: As a developer or embedder whose project carries a Tracker-scale tree (216 packages / 15,568 files / 73.6 MB) that must survive reload without a network round trip, I want first open and every reload to be storage-fast and honestly ready, but today the real embedder's cold open is 16.3 s with the per-file OPFS drain projected at 7.7 s of it, reopen is projected at 5 s, and each editor open copies the whole tree.
tier: production
---

## Outcome

Storage is most of the wait. The real embedder (tracker4, workbench 0.4.0)
opens snapshot T — 216 packages / 15,568 files / 73,637,414 logical bytes,
28.5 MB gzip, two wasm blobs holding 37.5 % of the bytes — in 16.3 s cold
(0.3.0: ≈ 50 s, 40.4 s of it stamp promotion); reopen was never timed
(`vfs/reference/tracker-embedder-snapshot-facts-2026-09-01.md`). The
reference benchmarks ran on surrogate S (14,492 files / 98,200,000 bytes —
the issue's base64 size, ×1.33 the real content): per-file drain 7.18 s
(ADR-0358, B4), fresh-process reopen 4.60 s (walk 1.71 s + preload 2.86 s,
C3), owner assignment 20 ms. Projected on T: drain 7.72 s, reopen 4.95 s —
the benches are ≈ 2× optimistic on the whole open; the drain share of the
16.3 s is unmeasured (map.md probe). Per-file handle open is half the reopen
cost (C1: 2.07 s open vs 1.50 s read, ≈ 0.14 ms/file), so ANY per-file layout
floors at 2–3 s on T whatever laziness or caching it adds — only a format that
reads few files escapes. A traced content-addressed segment replica measured
1.15 s append / 1.14 s validated replay on S (B2/B3, C3) → 0.86 s each way on
T. ADR-0358 named this exit: ">10x needs a pack-format layout change —
separate strategic decision".

Independently, every page read-file / read-directory copies the whole owner
tree: 46.5 ms per read on S (B0, 14,492 files; T has 7 % more files) and 82.4 % of a real
`ProjectDocument.open()` on a 521-entry / 51 MB template tree where the
absolute is 4.3 ms (C5) — each read transiently slices every file's bytes
(~74 MB on T). The two measurements are different trees; no whole document
open on T exists yet.

Clauses every slice keeps — the discriminators the rejected routes cite:

- (a) readiness is binary at the trusted stamp: `openProject` resolution is
  the ONE named await for an executable + durable session; no earlier session,
  no pending state a host must guess or poll.
- (b) guest-visible fs unchanged: Node programs see the plain Memory VFS
  (ADR-0072); no overlay, whiteout, or copy-up semantics.
- (c) one substrate under every writer (npm-client, editor, git, shell) under
  the existing persist-failure ledger, drain scheduler, and stamp barrier
  contracts (ADR-0358) — never a second writer, ledger, or publication journal.
- (d) reload honesty not weakened: every reachable storage fault (torn
  segment, corrupt frame/index, quota mid-append, cross-tab writer, compaction
  crash, legacy layout) ends in a consistent replay or the loud cold-restore
  path — never trusted torn state.
- (e) durable by default: public `storage.persistence` default and semantics
  unchanged; `ephemeral` stays an embedder recommendation.
- (f) reload without network: a tree persisted under `required`/`preferred`
  reopens from local storage alone, as today — never a registry, eddy, or
  snapshot fetch on the reopen path.

## User scenario

A developer opens a project, runs `npm install` producing a tree the size of
T (or an embedder materializes T itself), and `await openProject(def)` returns
a session whose `node -e` runs; the durable flush before that return took
≤ 2 s, not the projected 7.7 s. They reload the tab (fresh Chromium process, network off): the
session is executable again after ≤ 2 s of storage restore, not ≈ 5 s, with
edits made before the reload present. Opening one source file in the editor
or expanding one directory costs work proportional to that entry, not a copy
of the tree. A project last persisted by the old per-file layout is reported
by name and re-materialized from its definition; edits that lived only in the
old layout do not come back. Killing the page mid-append and reopening yields
a consistent tree or the loud cold-restore path.

## Invariants

<!-- Each false on 1a851d7bc (origin/main, 2026-09-01). Evidence:
     I1 — real embedder cold `openProject` on T: 16.3 s (workbench 0.4.0,
          quoted); B4 per-file drain of S: median 7,183.9 ms standalone →
          7.72 s projected on T; `openProject` awaits promotion/flush (C4).
          The drain share of the real 16.3 s is UNMEASURED — the run's first
          RED measures it on T's manifest.
     I2 — C3 current fresh-process reopen median 4,603.7 ms on S → 4.95 s
          projected on T; never timed by the embedder.
     I3 — `packages/vfs/src/opfs-sync.ts` `refreshIndex`/`preloadContent` read
          the per-file layout as project state; the store namespace
          `/.rifty/workbench/v1` (`workbench-project-store.ts`) is the only
          layout version marker and is not bumped; `project-materialization.ts`
          `open()` re-materializes `definition.files` only when the store
          record is absent, and `project-deps.ts` restores `node_modules`
          (ADR-0135) only when no stamp is trusted — a legacy tree with a
          record + valid stamp is trusted as-is. The gap is the trigger.
     I4 — `packages/workbench/src/workers/workbench-project-vfs.ts` read-file /
          read-directory call `authority.snapshot()`; `owner-vfs-authority.ts`
          `#snapshotEntry` slices every file's bytes: 46.5 ms on S (B0) vs
          4.3 ms on 521 entries (C5) — tree-size bound.
     I5 — today every path is per-file on reopen (≈ 0.3 ms each, C3), so a
          post-init `npm install` of package scale reopens at the per-file
          floor (~5 s on T); after slice A alone, 5k mutated paths ≈ 1.6 s on
          top of the 0.86 s base replay > 2.0 s. -->

1. I1. First open of T (manifest of the real tracker-plugin snapshot): the
   durable-flush tail before `openProject` resolves takes ≤ 2.0 s median
   under reference conditions — today the per-file drain alone projects to
   7.7 s inside a real 16.3 s open.
2. I2. Reopen of T in a fresh Chromium process, network off: storage restore
   before the session is executable takes ≤ 2.0 s median — today projected
   4.95 s (4.60 s measured on S).
3. I3. A project last persisted by the per-file layout is never read as
   project state: the owner reports the legacy layout by name and
   re-materializes from the project definition; edits absent from that
   definition do not reappear.
4. I4. A page read-file / read-directory costs the same on T as on a
   521-entry tree (≤ 2× apart) and ≤ 1 ms median for a ≤ 4 KB file or a
   ≤ 64-entry directory; a read never copies bytes of files outside the
   requested path — today 46.5 ms vs 4.3 ms, full-tree byte copy per read.
5. I5. After a post-init `npm install` that mutates ≥ 5,000 `node_modules`
   paths of T, the next fresh-process reopen still meets I2 (≤ 2.0 s
   median) and one persistence substrate holds every path (no per-file
   mutation layer) — today ~5 s per-file; after slice A alone > 2.0 s.

## Challenge

challenge: 2026-09-01 — 10 problems
- [BLOCKING: cheaper direct authority] Every byte the epic benchmarks is *derivable dependency content*, and main already has the authority to re-derive it: `tests/browser-unit/fixtures/real-tree-manifest.json` `stats` is `"generator":"npm install --ignore-scripts (real registry), gravity-ui dep set"` with paths like `@babel/runtime/helpers/…` — surrogate S is 100 % `node_modules`, and on the real shipped tree C4 measures "384 node_modules files / 47,212,791 logical bytes" of a "521 entries / 51,116,165 content bytes" owner tree (92 % of bytes); `packages/workbench/src/glue/project-deps.ts` already implements priority "2. **snapshot** — a baked asset matching the template AND the current package.json deps → restore it (no network, no resolver)" (ADR-0135), measured at "total … 241.895" ms for 47 MB in C4 and exercised on reload ("all five reloads applied the snapshot again"); scoping durable persistence to the non-derivable subtree and taking that existing path for the attested `node_modules` reaches I1 (nothing large to drain), I2 (nothing large to walk/preload) and moots I3 with **zero** new persistence authority, ADR, compaction, epoch/digest or production fault matrix — it costs only `node_modules`-local edit durability, exactly the loss I3 already accepts ("edits that lived only in the old layout do not come back"), and no `## Decisions` rejected route or map `## Out of scope` line names it (the nearest, "rejected route: `ephemeral` as the public default — violates Outcome (e)", rejects a *public default*, not per-embedder derivable-subtree scoping, so its clause does not exclude this route).
- goal.md's I3 evidence comment asserts "no layout-version check, no re-materialization path exists" — the layout-version half is true (no `layoutVersion`/`formatVersion` anywhere in `packages/vfs/src` or `packages/workbench/src`), but the re-materialization half is false on main: `project-deps.ts` documents and runs the `'snapshot'` provenance branch (`case 'snapshot': … 'baked node_modules restored'`), so the real gap is only a *trigger* into an existing path — and mislabelling that path as absent is what hides the cheaper route above [advisory].
- goal.md Outcome fuses two different datasets into one causal claim: "46.5 ms per editor read on S — 82.4 % of a real document open, B0/C5" — the 46.5 ms is B0 on the 14,492-file surrogate, the 82.4 % is C5 on a "521 entries / 51,116,165 content bytes" tree where the absolute is 4.320 ms; no whole-`ProjectDocument.open()` measurement on S exists, and the child doc itself says so ("The absolute cost is smaller than B0's 46.5 ms because this tree has 521 entries") [advisory].
- I4's user-visible materiality is still unanswered: the child's own `challenge: 2026-08-31` asked for "end-to-end latency share or workload prevalence" and the 2026-09-01 answer supplies a *share* (82.4 %) whose magnitude is 4.32 ms — saving ~4 ms (or ≤46 ms on a tree nobody has) is below perception; the stronger real justification the docs hint at but never size is the transient ~98 MB allocation per page read (`#snapshotEntry` does `readFileBytesSync(path).slice()`, B6 front already 105,339,948 bytes) [advisory].
- I4 is not checkable as written: "does work proportional to the requested entry — ≤ 1 ms median" mixes a proportionality test with a fixed cap, and the fixture holds 17 files >1 MB, max 15,591,326 bytes — a targeted read of that file must copy 15.6 MB and cannot be ≤1 ms, while the population the "median" ranges over is unspecified; this will stall at Contract+RED [advisory].
- I1's baseline is composed, not measured: B4 timed a standalone drain ("Real OPFS drain samples: … median 7183.915 ms"), while the only real end-to-end open measured (C4) shows the flush is largely *off* the reply already — "Making only `#completePromotion` background changed `openProject` median to 672.125 ms" from 687.580 ms, i.e. 15 ms, because "promotion already overlaps post-acquisition project setup"; no `openProject`-on-S number exists, yet I1 states "today 7.18 s" as the flush-before-resolution, more certainty than its own child claims ("proves a storage-boundary gain, not a one-second end-to-end readiness claim") [advisory].
- The candidate-B kill is a worst-case gate, not the goal's scenario gate: C1 kills B on a burst that touches all 14,492 files ("best lazy burst 4.423 s versus current preload 2.727 s") and on "the sync surface needs a 2.61 s pre-open of every handle", while the goal's own scenario after open is `node -e`, C1 measures a single lazy first touch at "median 0.530 ms", and nothing measures what fraction of the tree a real post-open workload touches; the repo also already owns synchronous-guest-over-async-host machinery the goal itself cites elsewhere (`packages/kernel/src/worker-entry.ts` `syncRing`, `packages/runtime-js/src/ipc/sync-rpc-fs.ts`) and never costs against "without new blocking machinery it must pre-open handles" [advisory].
- The playground data-loss fog is user-owned observable scope parked despite the user being in session: map.md carries "is loud loss at open acceptable … — owner: user — not answerable now", while ledger.md records "interview 2026-08-31..09-01; five user forks carried to goal.md §Decisions" — README §Epic fit says such a question "is asked at FIT while the user is there — a probe existing for its technical half is not a reason to park it", and this one decides whether named playground projects silently lose data [advisory].
- The map is effectively "do the whole epic in one child": item 2 `vfs/segmented-opfs-replica` carries "I1, I2, I3; the IRREVERSIBLE format ADR …, write path …, validated replay, legacy-layout cold restore, `## Fault matrix` at production tier" with the cut deferred to "PICKUP may split", while item 1 is explicitly "independent of the format, no new mechanism" and therefore proves none of the shared pattern README §Epic fit demands ("Seed order proves the minimal pattern first"); §Goal run's "the unit is too big: re-cut/split before implementation" applies at FIT, not at PICKUP [advisory].
- `tier: production` is committed for a persistence format whose central maintenance operation has zero evidence — map.md: "Segment compaction: trigger, crash point, proof — owner: agent … no measurement exists (rounds 1/2 never compacted)" — and the opportunity cost is unaddressed against ROADMAP M11 ("**ACTIVE — the current focus** … The wedge is *usage ergonomics*, not new runtime capability"), since the sole evidenced beneficiary is one embedder whose real trace the goal admits is unreachable ("The real 171-package trace is unreachable (issues #255/#256 hold aggregates only)") [advisory].

Disposition (2026-09-01): problem 1 closed by recorded user override —
`## Decisions` "route R" line (option 3 chosen; R violates Outcome (f) and
would be a second truth regime for one tree). Problems 2–6 answered in this
doc (I3 evidence corrected, Outcome attributes B0 vs C5, I4 rewritten as a
tree-size-independence test, I1 evidence states the unmeasured real open).
Problem 7 → map probe, settle before replica PICKUP. Problem 8 → asked and
answered (playground loud loss, `## Decisions`). Problem 9 → map re-cut into
slices A/B + legacy restore. Problem 10 → tier kept; opportunity cost was the
user's call and they proceeded.

## Decisions

- Route R fork (challenge problem 1) — decided **option 3** (user,
  2026-09-01): the replica persists every tree, `node_modules` included; the
  OPFS tree is the live source of truth from init on. Options weighed: (1)
  hybrid R-for-untouched-snapshot-subtree + replica; (2) R only, no format.
  Rejected because R's machinery (provenance-trusted stamp = supersede of
  ADR-0261 semantics, subtree persistence exclusion, touched-flip, re-apply on
  reload) shares nothing with the replica and would survive as a second truth
  regime for one tree (§Class-kill) or be deleted after; reload would depend
  on the HTTP-cached 28.5 MB asset and pay the decode tax every time; net gain
  over the replica on T ≈ 0.4 s per reload.
- Staged cut of the replica (user, 2026-09-01; README §Epic fit minimal
  pattern first): slice A = write-once base segment at init + replay on
  reopen, later mutations stay on today's per-file path with an explicit
  precedence + tombstone rule from day one; slice B = append of mutations
  into segments + compaction (re-emission of the base segment from the live
  front), per-file layer retired. Between A and B Outcome (c) is suspended
  by this decision — the tree has two persistence layers — and I5 is what
  closes it.
- Playground (user, 2026-09-01): breaking change — catalog projects (ADR-0165
  named / scratch) whose only source is the per-file layout are lost at open,
  loudly named; no export-before-switch prompt; the pre-existing ADR-0286
  archive is the user's own route.
- tier: production (2026-09-01) — a persistence format's product IS reload
  consistency; torn segment, compaction crash, and legacy layout are proven by
  a real-browser kill + reopen, not a unit fault decorator alone.
- Target scale = Tracker (user, 2026-09-01). Re-verified 2026-09-01 against
  the real embedder: the snapshot asset IS reachable locally (28.5 MB gz,
  pinned sha256) — its path/size manifest T replaces surrogate S as the proof
  substrate; S's 98.2 MB was the base64 size (×1.33 real content), S has 7 %
  fewer files. The asset never enters the repo.
- Budgets I1/I2 = 2.0 s: measured 1.15 s append / 1.14 s replay on S →
  0.86 s each on T; headroom ≈ 2.3× for ledger, stamp, owner hydration, and
  the two 12–16 MB wasm blobs. OS page cache stayed warm in C3
  — accepted limit; a cold-OS number is a probe (map.md), not a re-fit.
- Migration = cold restore (user, 2026-09-01): the legacy per-file layout is
  not read; re-materialize from the definition; edits without a source are not
  kept (playground consequence: previous line). Carrier (critic, 2026-09-01):
  bump the existing store namespace `/.rifty/workbench/v1` → `v2` in slice A;
  `v1` bytes stay untouched — never read, never deleted by this goal; the
  existing `project-materialization.ts` open path re-materializes from the
  definition with no new authority; the format ADR records the no-migration
  decision as an IRREVERSIBLE clause. A bounded one-time migration through
  the ADR-0165 §10 journal exists and was not taken (user: breaking change).
- Second tab on the same origin already fails loud on main
  (`WorkbenchOriginOccupiedError`, Web Lock `rifty:workbench:v1`,
  `ifAvailable`); the format ADR promotes this one-writer fact to a contract
  clause — replica epoch/digest honesty holds only under it (C2 honesty probe).
  No new mechanism (user, 2026-09-01).
- `storage.persistence: 'ephemeral'` = embedder recommendation in
  `packages/workbench/README.md` (this PR); public default unchanged → no ADR
  (user, 2026-09-01). Ephemeral does not lift COI: guest `readFileSync` blocks
  on the SAB sync ring (`packages/kernel/src/worker-entry.ts` `syncRing`,
  `packages/runtime-js/src/ipc/sync-rpc-fs.ts`).
- Readiness observability (user, 2026-09-01) = Outcome (a): no new host
  event; the format ADR states `openProject` resolution as the named
  executable + durable await, citing C4 (early reply → `node -e` fails with
  `package tree readiness is not published`).
- Cross-project dedup: not now; content addressing kept as the forward route
  (user). Sandbox fork: a capability for eval tests via manifests, never a
  speed lever here (user). Honest npm/pnpm later: the format reserves symlink,
  hardlink, mode (user).
- `cold-npm-install-speedup` Out of scope rejects "OPFS bulk-write
  consolidation" for breaking per-file `require()` addressability — that
  reason does not bind here: guests read the Memory VFS, only the persistence
  layer packs. The format ADR says so explicitly.
- Sibling `fault-honest-opfs-persistence` (ready, per-file substrate): its
  items stay valid logical-path contracts; the replica slice re-proves each of
  its rows on the new substrate (map.md fog) — never devalued silently.
- rejected route: candidate B (per-file content + durable index + lazy
  hydration) — violates I2 on full-scan workloads (C1: +1.70 s over current
  preload; the sync surface needs a 2.61 s pre-open of every handle). Holds
  only while post-open workloads touch most of the tree — the touch fraction
  is unmeasured (map.md probe, settle before ready). Its index stays a useful
  component of the replica.
- rejected route: deferred flush / early `openProject` reply — violates
  Outcome (a) (C4: `node -e` in the window fails; owner death in the window is
  the cold restore path anyway).
- rejected route: pending-ready session contract — violates Outcome (a);
  declined in `docs/adr/README.md` §Declined concepts.
- rejected route: layered / overlay FS visible to guests — violates Outcome
  (b); fork, export, and lazy scenarios ride manifests cheaper.
- rejected route: integrity-keyed CAS inside npm-client — violates Outcome (c)
  (writer-specific; dies under honest package managers).
- rejected route: `ephemeral` as the public default — violates Outcome (e).
- rejected route: route R (snapshot re-apply on reopen instead of persisting
  `node_modules`, options 1/2 above) — violates Outcome (f) once the subtree
  is touched, and Outcome (c) as a second persistence regime.
- rejected route: network re-derivation of an installed tree on reopen
  (re-install via lockfile/eddy instead of persisting `node_modules`) —
  violates Outcome (f).
- Snapshot decode tax on the open path (gunzip + `JSON.parse` 104.8 MB +
  base64 decode 98.2 M chars) is NOT this goal — owned by
  `playground/snapshot-carries-substituted-bytes-twice`; the map probe
  measures how much of the real 16.3 s is drain versus decode so neither goal
  claims the other's share.
- not a lever (measured): owner `#assignSubtree` 20 ms / 0.4 % (B1); sync
  lockfile SHA-256 ≤ 11 ms at 3 MB (B5).
