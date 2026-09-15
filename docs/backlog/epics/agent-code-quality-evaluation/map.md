## Items

1. `distribution/agent-eval-codex-reference` — native Codex reference over one existing task first; reuse existing runner/judges/artifacts and establish the new adapter's real execution proof.
2. `distribution/agent-eval-project-corpus` — judge-substrate probe first (which test runners install and run in COI/no-COI, how a test or CLI result is captured inside each lane), then six diverse pilot candidates, validated cards/reference solutions/judges, then an expanded frozen corpus; I1/I6/I7. Candidate curation can start independently of Codex; all-environment controls compose with item 1.
3. `distribution/agent-eval-comparison-report` — expanded experiment identity, uncertainty and honest matrix accounting; then a real reference campaign and regeneration proof. Depends on 1 and 2.

## Open questions

- Codex's actual event/usage/completion, cancellation and context-isolation behavior — owner: agent — pinned public-CLI probe at adapter PICKUP; help/version is not execution evidence.
- Own-environment judging beyond the preview: existing judges see only `previewUrl`/DOM/HTTP (`tools/agent-bench/src/judge/context.ts`); the COI lane exposes seed/export/metadata hooks only (ADR-0434 §2); Vitest 2.1.9 hits the legacy-esbuild install ceiling (`../../distribution/reference/agent-bench-baseline-results.md`). Which test runners/versions install and run in COI and no-COI, and how a regression suite or CLI result is captured inside each lane — owner: agent — first pilot probe, before case curation; a runner that cannot run in a lane is that lane's recorded capability gap, never hidden by choosing preview-only cases.
- Campaign size: roughly 20–30 cases × 4 environments × 3 trials ≈ 240–360 live runs plus reference solutions per environment; 2026-09-13 medians 62–83 s agent time with tails 329–541 s, plus cold real-project install in the browser — owner: agent — report PICKUP records the declared matrix, expected runs, wall-clock and usage before a campaign starts; the pilot corpus frozen under I7 closes I5, expansion carries its own campaign.
- Exact finite projects, starter versions, task snapshots and judge controls — owner: agent — follow the corpus item's pilot/admission route; record coverage gaps and selection reasons before the campaign, no success-selected pruning.
- Uncertainty estimator, number/order of trials and comparable-run rules — owner: agent — report PICKUP records the estimand and validates the calculation before the reference campaign; no automatic quality threshold.

These are implementation details within settled scope, not alternatives about
whose workflows or quality count. Draft children are compiled only at PICKUP.
The existing runner/report owns shared experiment state; no new scheduler,
storage service or parallel-run coordinator is presumed.
Corpus cards and pilot evidence stay with item 2; exact projects are selected
there, not asserted by the illustrative scenario list. Roughly 20–30 scored
cases and an app-heavy mix guide curation without replacing I6/I7 proof.
Case authoring is the main cost driver: pinned snapshot and package-lock v3,
reference solution, plausible-partial control, judge controls, patch-leak scrub
and four-environment reference runs per case; the pilot measures that cost
before any expansion. Each lane installs from the case's lockfile (Rifty
npm-client reads lockfile v3, ADR-0023); divergent resolution is a recorded
finding, not tolerated drift.

## Out of scope

- Empty-directory generation: user 2.2 chose installed minimal starters.
- Subjective architecture/readability/aesthetic scoring and automatic merge gate: user 1.3/1.4.
- Primary common-native grading or a controlled identical-agent experiment: user 1.1/2.1.
- New product UI, subagent orchestration, hosted eval platform and general runtime compatibility expansion: agent scope cut; measurement failures stay explicit, required harness defects are repaired in this goal.
- Erasing the old diagnostic's exclusions/history or claiming unsupported software works: never. New selected trials retain unsuccessful/unevaluable records and reasons.
