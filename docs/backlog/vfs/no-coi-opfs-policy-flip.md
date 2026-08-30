---
area: vfs
status: draft
title: OPFS backend without COI — drop the policy condition in detectVfsBackend + reload proof
created: 2026-08-28
epic: no-coi-sandbox-tier
why: boot.ts:23 forces the memory backend whenever !crossOriginIsolated — OPFS has no platform COI need (spike-proven policy gate), costs persistence in the no-COI tier; the drop is RECORDED in ADR-0368, this slice implements it
user_story: As an agent platform on a headerless page, I want a project to survive a page reload, but today the VFS silently degrades to memory because the OPFS backend is COI-gated by policy
sources: [ADR-0368, ADR-0072, docs/backlog/distribution/reference/no-coi-hmr-spike-record.md]
code: [packages/vfs/src/boot.ts, packages/vfs/src/opfs-sync.ts]
---

## Context

`detectVfsBackend` (boot.ts:23) requires `crossOriginIsolated === true` before selecting
'opfs'. Spikes ran the full loop (install, build, 100 HMR cycles, clean-reload byte-for-byte
survival) on `installOpfsFs()` forced past the gate in a no-COI worker — zero errors. The
condition is a deploy-environment proxy (file header: Node tests vs isolated deploy), not a
platform need. The drop is RECORDED: ADR-0368 (accepted 2026-08-29, created at bare-sab-guard
Contract+RED checkpoint 4) — `detectVfsBackend()` → `'opfs'` iff `OpfsVfs.isSupported()`
(platform probe alone; the `crossOriginIsolated &&` conjunct of ADR-0072/0013 falls, dated
correction note + README row already recorded). This slice IMPLEMENTS that active ADR — no
pickup ADR work remains, and re-litigating the predicate would amend an active ADR.
Selection-vs-capability precision, reconciled with the recorded choice: `OpfsVfs.isSupported`
(opfs.ts:46, `storage.getDirectory`) is the realm-agnostic selection probe — the sync-side
capability (`OpfsFsSync.isSupported`, opfs-sync.ts:241-252: worker realm +
`FileSystemFileHandle.prototype.createSyncAccessHandle`) is always false on the main thread,
so as the SELECTION predicate it would flip main-thread boots to memory; it stays the LOUD
sync guard instead — `OpfsFsSync.init` throws `NotImplementedError` inside `installOpfsFs`
(opfs-sync.ts:288), so a getDirectory-present/createSyncAccessHandle-absent realm fails loud
at boot, never a silent memory downgrade — and the slice's no-COI reload-durability proof
exercises that real sync path. Scope: drop the conjunct per ADR-0368 + a no-COI
reload-durability proof; existing COI OPFS behavior byte-identical (ADR-0368 Decision).
Proof vehicle: browser-unit no-COI page driving the sandbox worker directly (substrate from
the bare-sab-guard slice — `tests/no-coi/` lane, ADR-0369); the full-loop e2e reload proof
belongs to the goal's composition fog (map §Fog) — the playground path
(`owner-persistence-reload.spec.ts`) is NOT usable here (ADR-0165 pins its COI assert).
Cross-link `vfs/opfs-persistence-browser-roundtrip` residual. Out of scope: flush semantics
under forced kill (declared tier boundary — cross-generation risk recorded in the epic).

## Challenge

challenge: 2026-08-28 — 4 problems
- Evidence not where the doc points: sources list [ADR-0072, runtime-js/reference/no-coi-degradation-probes.md], but the probes doc contains zero OPFS/reload/durability rows (verified grep; its provenance is the first spike only) and ADR-0072 is about the content cache — the load-bearing reload-proof lives only in FINDINGS-HMR.md §5-6 on rot-prone branch t3code/prototype-hmr-agent-scenarios, which that same probes doc says must be inlined to a durable record before building on it.
- Factual error in `why`: OpfsVfs.isSupported (packages/vfs/src/opfs.ts:46-50) checks navigator.storage.getDirectory presence, never createSyncAccessHandle — so the promised 'capability-based selection' as described does not actually test the sync-access-handle capability OpfsFsSync needs, and the doc's stated basis for the flip misdescribes the code.
- Proof vehicle has no substrate at this map position: the scoped proof is 'a no-COI sibling of tests/e2e/owner-persistence-reload.spec.ts', but that spec drives the playground owner UI (launcher/terminal helpers), the playground COI hard-assert is pinned by ADR-0165 and playground no-COI mode is explicitly out of the epic's scope (map §Out of scope), and the alternative no-COI sandbox composition only arrives in the later build-loop slice (map item 4) — the item must name what harness actually hosts its e2e or it cannot close its own acceptance.
- Recorded-decision handling unscoped: ADR-0072:5 explicitly carries ADR-0013's boot detector 'unchanged' and ADR-0165:17 restates detectVfsBackend's isolated-only semantics, yet the item scopes no superseding/amending ADR for overturning that condition (CLAUDE.md: contradicting an ADR is IRREVERSIBLE → adr:new).

<!-- Post-challenge edits: P1 → sources now cite the inlined durable record
     (distribution/reference/no-coi-hmr-spike-record.md). P2 conflated OpfsVfs with
     OpfsFsSync — the doc's claim was about OpfsFsSync.isSupported (opfs-sync.ts:241-252,
     checks createSyncAccessHandle); Context now names both classes explicitly. P3 → proof
     vehicle named (browser-unit no-COI page from bare-sab-guard substrate; e2e rides
     build-loop lane). P4 → amending ADR added to pickup scope.
     Re-cut 2026-08-30 (bare-sab-guard Contract+RED checkpoint 6, goal drift): ADR-0368 now
     EXISTS and records OpfsVfs.isSupported() as the selection predicate — the draft's
     OpfsFsSync-as-predicate requirement and P4's pickup-ADR scope are superseded by the
     recorded choice (unpicked draft, re-cut freely); sync capability keeps its loud guard
     in OpfsFsSync.init. P3's build-loop lane no longer exists as a named item (dissolved to
     map fog, checkpoint 4) — e2e reload proof re-routed to the composition fog. -->
