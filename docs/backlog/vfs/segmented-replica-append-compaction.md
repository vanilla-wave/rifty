---
area: vfs
status: draft
title: Segmented replica — append mutations into segments and compact; retire the per-file mutation layer
created: 2026-09-01
why: slice A of the replica persists the init tree as a base segment but leaves every later write on the per-file OPFS path, so a post-init `npm install` (thousands of paths) puts reopen back on the per-file floor and one tree has two persistence layers
user_story: As a developer who runs `npm install` after the first materialization (a new dep set, a regeneration — thousands of `node_modules` paths), I want the next reload to be as fast as the first one, but after slice A every such path is again a per-file OPFS read on reopen (≈ 0.3 ms each: 5k paths ≈ 1.6 s on top of the 0.86 s replay) and the base segment never absorbs them.
epic: fast-project-open-reopen
blocked_by: [vfs/segmented-opfs-replica]
sources: [docs/backlog/vfs/reference/storage-journal-design-benchmarks-2026-08-31.md, docs/backlog/vfs/reference/storage-open-reopen-candidate-benchmarks-2026-09-01.md, docs/backlog/vfs/reference/tracker-embedder-snapshot-facts-2026-09-01.md, docs/backlog/vfs/storage-pressure-and-eviction-ux.md]
code: [packages/vfs/src/opfs-sync.ts, packages/vfs/src/opfs-drain-scheduler.ts]
---

## Context

Slice B of the staged cut recorded in `epics/fast-project-open-reopen`
(goal `## Decisions`, map item 3); proves goal I5. After slice A the
persistence substrate is: one write-once base segment (init tree) + today's
per-file layout for every later mutation, joined by a precedence + tombstone
rule. Sized against the goal budget: a leftover per-file path costs
≈ 0.25–0.32 ms on reopen (C1/C3 per-file figures over 14,492 files), so
source edits and git commits (10¹–10² paths) are < 1 % of I2's 2.0 s and are
NOT this item's value. The value scenario is package-scale mutation after
init — `npm install` of a new dep set, regeneration, a second template's tree
— thousands of paths: 5k paths ≈ 1.6 s + 0.86 s base replay > 2.0 s, and a
full re-install returns reopen to the per-file floor (~5 s on T). Goal
Outcome (c) additionally requires ONE substrate under every writer at goal
close; the two-layer state between A and B is allowed only by the staged-cut
decision.

Mechanism, minimal form:

- Post-init mutations append frames to the active segment (same frame format
  as the base segment: paths, kind, mode, mtime, SHA-256, CRC32, content);
  deletions and renames are tombstone frames. The per-file mutation layer and
  its precedence rule retire in the same slice.
- Compaction = re-emit a fresh base segment from the live in-memory front
  with slice A's base-segment writer (the full logical tree is always
  resident — ADR-0072 content cache, goal Outcome (b)), then a crash-safe
  swap and removal of the superseded segments. No read pass over old
  segments, no per-frame liveness bookkeeping, no live/dead ratio: the
  trigger is appended bytes since the last base ≥ a fraction of the base (or
  segment count), settled in the format ADR.
- Ordering owner stays the drain scheduler's per-path FIFO + stamp barrier
  (ADR-0358); the append writer is its sink, not a second queue. The swap is
  ordered by the same settle barrier — no new epoch: the class inventory
  (stamp `durability: 'pending'` + claim epoch in `install-stamp.ts` /
  `package-acquisition-authority.ts`, `OwnerEpoch` in the owner VFS client)
  is re-stated in the ADR and none is duplicated. Which half of ADR-0358
  dies with the per-file layer (~16 lanes, dir-handle reuse, ancestor-chain
  gating, rm/rename subtree fences — all forced by per-file writes) and
  which survives (per-path ordering contract, reporting/settle barrier,
  persist-failure ledger) is stated explicitly in the ADR — constraint gone
  → deletion, not port.

Unmeasured today, probed before this item's PICKUP (goal map fog): append
cost per small write versus the current per-file write-through (the spike
measured bulk append only — 85.5 MB/s at 4 MiB chunks) and the compaction
trigger threshold.

Fault rows this item owes at production tier: torn frame at the append tail
(truncate to the last valid frame, never a torn read); quota mid-append
(ledger failure, stamp stays pending); quota during compaction — old + new
segment resident at once, so compaction needs headroom ≈ live bytes: refused
loudly through the `persistence` health event, appends continue, segment
growth visible (`vfs/storage-pressure-and-eviction-ux`), never a silent
unbounded file; crash between new-base durable and old-segment removal (both
readable → the settle-barrier sequence names the winner); corrupt frame
inside a compacted base (cold restore); `lossy-aggregate` — every frame keeps
its exact affected path list so the path-granular persist-failure ledger
still matches (`isStampedTreeDamage`); `provenance-lie` — a content-addressed
block is served only after its SHA-256 verifies against the frame it was
written with; cross-tab writer (already loud via the origin Web Lock).

## Challenge

challenge: 2026-09-01 — 9 problems
- [BLOCKING: value does not follow] The user-visible half of the claimed value is never sized: `why:` says "a project's reopen cost grows with its edit history" and the `user_story` names the persona's work as "npm install, edits, git", but the doc's own evidence puts a leftover per-file mutated path at ≈0.25 ms (C1 cached burst, `storage-open-reopen-candidate-benchmarks-2026-09-01.md` line 52-54: "handle open 2071.420 ms … sync reads 1496.505 ms" over 14,492 files) to ≈0.32 ms (C3 current total 4,603.720 ms / 14,492), so against I2's "≤ 2.0 s median" minus slice A's projected 0.86 s replay (`tracker-embedder-snapshot-facts` T table) the leftover layer needs ≈3.5–4.6k mutated paths before it breaches anything — source edits and `git` commits reach 10¹–10², i.e. well under 1 % of the budget; the value follows only for a re-install / regeneration-scale mutation set the doc never names, so name that scenario (or record an override) before compile.
- [BLOCKING: cheaper direct authority] Compaction is specified as a read-and-filter pass — "rewrite live frames into a fresh segment" (line 24) — but the complete logical tree is always resident (B6: "backing storage 98,335,264" / "total measured footprint 105,339,948" for the whole tree; goal Outcome (b) keeps the Memory VFS as guest truth), so a fresh segment can be serialized straight from the live front using the base-segment writer slice A already builds at "85.50" logical MB/s (B2/B3, 4 MiB row) — no read pass over the old segment, no per-frame liveness bookkeeping, no "live/dead ratio" trigger, identical output and identical crash-safe swap; that is materially less mechanism for the same value and the doc must take it or record why it does not.
- [advisory] §Class-kill sweep is one sentence and inventories the wrong class: the item adds an epoch comparison ("both readable → newest wins by epoch", line 37) while `fault-classes.md` line 48 requires "Before adding correlation/FIFO/epoch/ledger/lock, inventory the class repo-wide" — main already carries at least three epoch instances (`install-stamp.ts:48` `durability?: 'pending'` + `epoch`, `package-acquisition-authority.ts` claim epoch, `OwnerEpoch` in `owner-vfs-client`), and ADR-0358's own five-entry inventory with each reuse rejected by named reason is the form this sweep does not meet.
- [advisory] ADR-0358's survival is asserted, not checked: the sweep says its "per-path ordering, ancestor fencing, and stamp barrier … stay the ordering owner", but once "the per-file mutation layer … retire[s]" there are no per-file OPFS writes left, so ADR-0358 §Decision's "~16 concurrent lanes", dir-handle reuse, "Ancestor-chain gating" ("`OpfsVfs.writeFile` creates no parents") and "Subtree fences for rm/rename" lose the constraint that forced them — `fault-classes.md` line 50: "constraint gone → deletion, not port"; the draft should say which half of ADR-0358 dies rather than claim continuity.
- [advisory] Two fault rows the blocking sibling explicitly parked for exactly this operation are missing: `segmented-opfs-replica.md` line 82-86 lists "provenance of content-addressed blocks; exact path-list identity (`lossy-aggregate`); compaction crash" as rows to settle, and merging frames re-aggregates the per-frame path lists the ledger is keyed on (same doc, line 59-61: "persist-failure ledger stays logical-path granular; every segment records its full affected path list") — the draft's row list carries neither `lossy-aggregate` nor `provenance-lie`.
- [advisory] The quota row is written for append only ("quota mid-append (ledger failure, stamp stays pending)"), but compaction needs old + new segment resident at once — on a quota-tight origin compaction can never complete and the segment grows without bound with no named degradation; `vfs/storage-pressure-and-eviction-ux` exists and is not cited.
- [advisory] README §Epic fit line 103-104 — "a child whose contract depends on an open question is not seeded" — and this child's contract *is* its open questions: "Unmeasured today: append cost per small write …, the compaction trigger (live/dead ratio, segment count), and the crash surface of the swap"; worse, the fog line that used to track them (quoted in `goal.md` line 121: "Segment compaction: trigger, crash point, proof — owner: agent … no measurement exists (rounds 1/2 never compacted)") no longer appears in `map.md` `## Open questions` (four questions, none about compaction), so the only surviving carrier is this draft's prose.
- [advisory] Goal-clause contradiction the draft surfaces but does not name: `goal.md` line 38 frames (c) as a "Clause[] every slice keeps … never a second writer, ledger, or publication journal", yet this item treats it as a deliverable ("Goal Outcome (c) requires ONE substrate under every writer: this item moves post-init mutations into appended frames") and its `why:` concedes the interim state — "one tree has two persistence layers"; the staged cut (`goal.md` Decisions line 145-149) therefore suspends a clause the goal says every slice keeps, and nothing records that.
- [advisory] Direction / tier: `map.md` item 3 is the only slice carrying no invariant (item 1 → I4, item 2 → "I1, I2" + I3 first half, item 4 → I3 second half; item 3 → "Outcome (c)"), while README §Goal run closes a goal on "end-to-end proof of `## Invariants`" — so the most machinery-heavy slice, at inherited `tier: production` ("robust + crash/reload consistency + e2e fault proof"), is the one the goal's own closure test does not require; this is the goal's own unclosed challenge problem 10 landing in a child, against ROADMAP M11 "**ACTIVE — the current focus**".

Disposition (2026-09-01): both blocking problems answered above — value
scenario named (package-scale post-init mutation, goal I5 added), compaction
re-specified as base-segment re-emission from the live front. Advisory 3–6
answered in Context (epoch inventory + settle-barrier ordering, ADR-0358
death list, `lossy-aggregate` / `provenance-lie` / compaction-quota rows).
7: compaction fog line restored in goal map (probe before this PICKUP). 8:
goal Decisions now records that the staged cut suspends Outcome (c) between
A and B. 9: goal I5 makes this slice closure-required.
