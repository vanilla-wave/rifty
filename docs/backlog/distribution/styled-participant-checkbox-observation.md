---
area: distribution
status: draft
title: "How should agent-bench activate an operable styled native checkbox?"
created: 2026-10-15
why: A selected native checkbox input is covered by its decorative span while its associated label still activates it
sources: [docs/backlog/distribution/reference/agent-eval-pr341-v18-completed.md]
code: [tools/agent-bench/corpus/cases/expense-settlement-v11/judge.ts, tools/agent-bench/src/judge/context.ts]
---

## Question

What existing interaction owner should observe standard native checkbox state
when a direct input pointer target differs from its actual associated label?
Public prompt explicitly permits standard checkboxes and open styling. No
forced event, hidden-control admission or generic coordinate policy proposed.

Original nativePi expense3 selectedFAIL: own selected-state check span intercepts
setChecked input target. Actual production participant owner in realChromium,
exact retained native label/input and complete state CSS: unchecked direct
works; selected directFAIL; label activates same input in both states. Earlier
partial-CSS fixture omitted the selected rule, never counted as RED/proof.

`pnpm exec tsx /tmp/pr341/v18-participant-label-complete-css.mts`; actual HTML,
CSS/states/error and sourceSHA retained in canonical repair-diagnostics.
Readonly fixture is not whole-task PASS, model trial or score replacement.

Owner: distribution/agent-bench. Trigger: next terminal/choice/presentation
observation pickup or reproduce this public path. No proposed code/gate change;
source stays at accepted revision. Native expense1/3PASS and booking3/3PASS,
so handoff conditional0/3 does not authorize another workflow oracle revision.
Dedup: distribution titles/code/goal maps, traps and ADR declined concepts;
no matching boundary item. Native confirmation question is separate.
