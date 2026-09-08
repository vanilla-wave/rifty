# Ledger — self-hosted-snapshot-workbench

- 2026-09-07 — refined selected embedder feedback; empty new namespace and retained orphan download decisions recorded in goal.md.
- 2026-09-07 — user selected producer tar.gz and collision-free envelope namespaces; archive question closed in goal.md; representation deduplicated with the existing snapshot byte-cost draft.
- 2026-09-07 — independent goal and seven child critiques clear; residual dedup critique preserved and its value claim corrected; FIT destination ready, children remain draft.
- 2026-09-07 — user questioned scope closure; audit found F1 private-registry admission and F2 existing-project snapshot upgrades; goal demoted before first pickup, prior destination retained, evidence appended.
- 2026-09-07 — round 2 user closed F1/F2: environment-owned registry access; explicit apply/default initial-only modes with saved-state priority; I8 added at pre-run re-fit; dependent F3/F4 asked in round 3.
- 2026-09-07 — round 3 user resolved F3/F4 with generic overwrite/error conflict policy; dependency-specific fork framing discarded; application-policy child added for I8 before strict acquisition; re-fit critique pending.
- 2026-09-07 — re-fit goal, producer, strict acquisition and new application-policy independent critiques clear; eight draft children, goal ready after settled rounds 2/3.
- 2026-09-08 — user authorized whole-goal implementation in PR #316; codec split before producer while lockfile admission is probed; no destination change.
- 2026-09-08 — dep-snapshot-tar Contract+RED PASS @ 04bf115f294f9ebfbcc8388accf5202e9a36bf46; fresh reviewer tar_red_verify; after main merge 9b528dbb2, unchanged codec rerun: 4 expected RED / 36 GREEN.
- 2026-09-08 — user asked for a separate PR of the PR #316 goal; work continues on `self-hosted-snapshot-workbench` / PR #322. Codec files carried from #316; producer compiled (ADR-0389) with 6 expected RED.
- 2026-09-08 — producer Contract+RED reception: FIX local tar fixtures and createMemoryFs `{ fsSync }`; foreign `_test-fixtures` import and `{ fs }` destructure were authoring defects, not destination changes.
- 2026-09-08 — producer implementation: sealed `@riftydev/workbench/dep-snapshot` calls existing install() and emits ADR-0386 tar; six producer tests green.
- 2026-09-08 — re-chart after distribution/dep-snapshot-producer (final-green PASS @ 067f1f9654b15742f7f4008f569a739aa8f17f66): sealed produce/restore landed; packed produce/restore from an installed tarball stays an I1 residual for the composed packed-host proof. Next unblocked: static-assets, application-policy, storage-namespace, operation-budgets.
- 2026-09-08 — re-chart after distribution/workbench-static-assets (final-green PASS @ 214d95d861bf47922db8a4fb8e8836ada5930f92): copyable `dist/runtime/` and packed-consumer boot through copied URLs landed. Next unblocked: application-policy, storage-namespace, preview-prefix, operation-budgets. Snapshot-only still waits on policy.
