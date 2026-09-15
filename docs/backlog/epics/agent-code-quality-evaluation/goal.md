---
kind: epic
status: ready
title: Compare sandbox coding outcomes with native Pi and Codex
created: 2026-09-15
value: A Rifty maintainer can repeatedly measure whether sandbox agents deliver working JS/TS changes and applications as reliably as native agents, with inspectable failures and uncertainty.
user_story: As a Rifty maintainer, I want comparable coding experiments across real projects and different starters, but today's five-task diagnostic has no Codex reference or uncertainty estimate.
tier: works
---

## Outcome

Extend the existing private `tools/agent-bench` into a repeatable comparison
of Rifty versus native Pi using the same model, with native Codex as an
additional labelled reference. Measure functional success in each agent's
own environment: fulfills the task, passes checks, preserves existing behavior.
Deliver the reusable experiment and an inspectable real reference report;
worse sandbox results or insufficient evidence are valid conclusions.
The payoff is evidence of where browser Node limits real coding workflows.

## User scenario

1. A maintainer selects a versioned task suite containing bug fixes and feature
   additions in several real JS/TS projects, plus application-building prompts
   starting from different minimal starters with installed dependencies.
   Case cards expose provenance, requirements, regression obligations and why
   each case exercises a distinct engineering problem. App cases cover linked
   user workflows; framework swaps alone do not establish diversity.
2. They configure model/endpoint for Rifty and native Pi, and the native Codex
   reference's model/settings, then run repeated independent trials over the
   declared matrix. Both existing Rifty paths remain: actual COI +chat and
   packed no-COI SDK. Every agent receives the same task and starting project
   for a comparison; host/tool differences remain explicit.
3. The same functional requirements and regression checks judge the result in
   its originating environment. A program failing in Rifty is unsuccessful
   there even if the exported code could work on Node. No code-style,
   architecture or aesthetic score substitutes for functional proof.
4. The report shows per-task/environment results, Pi comparison, separate Codex
   reference, uncertainty, time/usage and supported failure attribution, with
   retained attempts and artifacts. Missing capability or setup/provider/judge
   failure cannot silently remove a selected trial or become success.
5. They rerun after a change or regenerate a report from retained evidence;
   task/model/dependency/judge/config changes are visible. They can inspect
   failures without mistaking aggregate success for proof of equality.

## Invariants

Baseline `51440931a`: evidence in
`../../distribution/reference/agent-code-quality-refine-evidence.md`.
I1 absent: five template-bound tasks only. I2 absent: three lanes, no Codex.
I3 absent for I1's new corpus: existing judges check five task-specific previews.
I4 absent: raw per-task deltas only, no uncertainty or expanded experiment identity.
I5 absent: retained 42-run report covers only the previous corpus and lanes.
I6/I7 absent: no expanded case-card/control catalog or family-separated pilot
and evaluation corpus; the original five tasks remain the only task set.

- I1. A finite versioned suite covers bug fixes and feature additions across
  multiple real JS/TS projects, and application creation across multiple
  distinct minimal starters with installed dependencies. Tasks have explicit
  requirements, one pinned lockfile installed by every lane and independently
  checked judges that accept working solutions and reject unmet
  requirements/regressions.
- I2. The suite runs through actual COI +chat, packed no-COI SDK, native Pi CLI
  and native Codex. Pi/Rifty comparisons share the model and task input;
  Codex's actual model/configuration and all tool/context/dependency differences
  are recorded. No same-harness or environment-only causal claim is implied.
- I3. Each selected trial receives an honest own-environment result from
  common functional/regression requirements. Setup, unsupported capability,
  provider, budget, runtime and judging failures remain visible; cause is
  evidence-backed or unknown. A native-only success never rescues a Rifty fail.
- I4. Repeatable reports identify the suite, starting project/dependencies,
  judges, agents/models/settings and source versions; retain original attempts
  and artifact links; show per-task and per-workload results, Pi deltas,
  separate Codex reference and uncertainty with stated assumptions. Too few
  or incomparable observations produce an explicit limitation, not equality.
- I5. A real on-demand reference experiment exercises both workload groups and
  all four environments, retains the declared matrix and repeated attempts,
  and demonstrates report regeneration without new model calls. Deterministic
  plumbing controls alone cannot close this invariant; failures need not all
  become successes for the measurement to be complete. The validated pilot
  corpus, frozen and family-split under I7, can close it; expansion carries
  its own campaign and proof.
- I6. Each scored case has a pinned starting project, provenance, explicit
  requirements/regressions and an inspectable difficulty rationale grounded in
  diagnosis, interacting behavior or compatibility. Its trusted checks reject
  the unmet task and plausible incomplete solutions while accepting working
  alternatives; hidden checks add no unstated requirements or arbitrary UI
  structure. Reference solutions are exercised in every selected environment,
  with failures retained as environment evidence rather than corpus exclusions.
- I7. A reviewed pilot precedes the expanded, versioned evaluation corpus;
  calibration/evaluation separation accounts for related task families.
  The final corpus and selection reasons are fixed before the comparative
  campaign; Rifty failures cannot justify post-hoc removal. Reports separate
  the existing smoke/regression set, task groups and repeated trials, so easy
  controls or repetitions cannot masquerade as broader capability coverage.

## Challenge

challenge: 2026-09-15 — clear

Fresh premise review `/root/eval_scope_challenge`: extend the existing bench;
new value is broader workloads, Codex and honest functional comparison.
Full verdict and original sources:
`../../distribution/reference/agent-code-quality-refine-evidence.md` §Early Challenge.
Its two pending scope choices are resolved by user answers 2.1/2.2 there.
Corpus amendment reuses `/root/corpus_challenge`'s independent critique and
the user's acceptance; record: the same evidence file §Corpus discussion.

## Decisions

- user 2026-09-15, 1.1: native Pi with the same model; «+ для референса codex».
- user 2026-09-15, 1.2: bugs/features in real JS/TS projects plus building applications.
- user 2026-09-15, 1.3/1.4: functional correctness/no regressions; repeatable report with uncertainty and causes.
- user 2026-09-15, 1.5/2.1: «Основной результат — работает ли решение в своей среде».
- user 2026-09-15, 2.2: «2, но стартеры разные» — multiple installed minimal starters, not empty projects.
- amend: 2026-09-15 — user: «выглядит ок. А как это в эпик положим?» accepting the preceding corpus proposal — scenario 1 and I6/I7 require substantive case diversity, discriminating judges and a pilot/frozen corpus; full exchange and bounds in refine evidence §Corpus discussion.
- agent: six pilot candidates (two bugs, two features, two starter apps), then roughly 20–30 scored cases, are route estimates, not closure by count; the suggested two-thirds apps mix is indicative, not an accepted exact quota.
- amend: 2026-09-15 — user: «Внеси правки» accepting the PR #341 review findings — judge-substrate probe (test runners/command-result judging inside COI and no-COI) precedes case curation; campaign size and per-case authoring cost are recorded before a campaign; I5 closes on the validated pilot corpus, expansion is a follow-up slice; each case pins one package-lock v3 installed by every lane. Source: refine evidence §PR review amendment.
- agent: preserve ADR-0434's real COI/no-COI lanes, privacy, on-demand execution and diagnostic interpretation; no new platform or runtime API prescribed.
- agent: tier works; reachable faults may fail loudly, but never manufacture success or conceal selected trial failures; no crash-resume service promise.
- agent: finite corpus, repeats and statistical method are chosen and recorded before measuring; task-specific model tuning and success-based exclusions cannot define the result.
- agent: Codex is a native reference with declared configuration, not a forced same-model causal control; public CLI help proves only available options.
- rejected route: rerun the unchanged five-task bench — violates I1, I2 and I4.
- rejected route: judge only exported code on native Node — violates scenario 3 and I3.
- rejected route: build a second eval platform — existing ADR-0434 harness supplies the substrate; no additional outcome requires one (REV-7).
