---
area: distribution
status: draft
title: Add one workflow paragraph (locate, reproduce, change, re-run, edge cases) to the prompt profile under a new profile id, on by default with a recipe:false switch
created: 2026-09-27
why: Weak models need the working procedure stated; a September 2026 ablation shows planning text is an accuracy scaffold for weaker models, and the mini-swe-agent prompt states exactly this recipe.
user_story: As a developer running the agent on a weak model, I want it to reproduce before editing and re-run after, but today the profile says only "be concise, show file paths, follow project instructions".
epic: agent-weak-models
blocked_by: []
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md, docs/adr/distribution/0434-run-a-three-lane-pi-benchmark-with-shared-profile-and-native-judges.md]
code: [packages/agent/src/prompt-profile.ts, packages/agent/src/prompt.ts, tools/agent-bench/tests/contract.spec.ts]
---

## Context

finding — goal slice 11 (I11); after slice 4 (baseline before mechanisms).

- Ours: `prompt-profile.ts` paragraphs intro / guidance / recovery /
  verification, id `pi-0.85.1+rifty-adapter-v1`; the bench asserts the
  paragraphs (`tools/agent-bench/tests/contract.spec.ts`); the active
  constraint is ADR-0440 §4 "Preserve profile id/paragraphs" (ADR-0434
  decision 3's prompt clause was superseded by its 2026-09-18 §Corrections
  note).
- Evidence (§Research): arXiv 2609.20804 — planning is an accuracy scaffold
  for weaker models; DeepSWE notes the mini-swe-agent recipe (find files,
  reproduce, edit, re-run, check edge cases).
- After this slice: one new paragraph in the profile, ~100–150 tokens; id
  bumped; `recipe: false` session option removes it and the trace `config`
  records the switch (answer 1: every mechanism has an explicit off switch);
  bench contracts updated to the new default paragraphs; ADR-0440 §4 receives
  a dated §Corrections note (`DEC-2`). No task-specific text, no per-model variants.

## Challenge

challenge: 2026-09-27 — inherits `epics/agent-weak-models/goal.md` §Challenge (10 problems, resolved there); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions (prompt recipe, tier).
