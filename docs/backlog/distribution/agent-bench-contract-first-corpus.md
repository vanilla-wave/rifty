---
area: distribution
status: draft
title: "Contract-first app corpus: prompt-stated module API, test judges, calibration before freeze"
created: 2026-10-17
why: The only app judges that survived PR #375 are the two calibrated CSV/notes cases; booking/expense left with their caption-discovery engine (ADR-0535). The benchmark needs app tasks whose oracle is trivial before any new model series.
sources: [docs/adr/distribution/0535-judge-app-tasks-against-a-prompt-stated-contract.md, docs/adr/distribution/0506-judge-frozen-project-corpus-in-each-originating-environment.md, tools/agent-bench/reports/summaries/2026-10-15-eval-v18-corrected/README.md]
code: [tools/agent-bench/corpus/core-v1.json, tools/agent-bench/src/corpus.ts, tools/agent-bench/src/judge/context.ts]
---

## Context

ADR-0535 decides the shape: the public prompt states the module API (exported
functions, types, persistence schema) plus the accessible names of the few controls
one smoke touches; the judge is a test file executed in the originating environment
through the existing command-judge path (ADR-0506) and at most one Playwright smoke
through the declared names. `core-v1` has no such case yet: `csv-workflow-v5` and
`markdown-notes-v4` keep their ADR-0508/0509/0510/0513/0514/0515 browser judges.

Next unit (`core-v2`): 3–4 app tasks on the installed starters (React/TS, vanilla,
Vue, Svelte) with

- a prompt carrying the module API and the UI contract;
- a judge test (node:test/assert in the origin) + one smoke;
- a committed calibration set: ≥3 correct implementations in different UI styles
  (100 % pass) and ≥3 wrong ones, one per stated requirement (100 % fail);
- regression sources pinned like the library cases; `starterRegression` build/boot.

The rifty-vs-native delta on these cases measures Node fidelity in the browser
(fs/persistence, module resolution, timers, URL/encoding), not UI guessing.

Why the two retained browser judges go too (independent review of PR #375, round 3,
executed mutants against `markdown-notes-v4/judge.ts`): a status reading "Ready"
instead of the missing-target message passes 7/7 (`judge.ts:48`); a Save that returns
early when the current note exists passes 7/7 while the public edit→Save→reload probe
shows the original body (`judge.ts:85`). Snapshot-change probes do not discriminate the
declared behaviour; a test against a stated API does.

## Challenge

challenge: 2026-10-17 — clear (decision taken with the user in session; the
objection "prescriptive prompts measure contract implementation, not UI freedom" is
recorded in ADR-0535 as the measured quantity).

## Decisions

- 2026-10-17 — shape fixed by ADR-0535; no `rifty-refine` interview (user-authorized).
- Open at pickup: which four starters/domains; whether the smoke runs in all four
  lanes or only the two Rifty lanes (native lanes already execute the test judge).
