---
area: distribution
status: draft
title: "How should agent-bench observe native confirmation of requested actions?"
created: 2026-10-14
why: Default dialog dismissal can record FAIL for a valid requested Delete action; native retained app passes unchanged judge when confirmation is accepted
sources: [docs/backlog/distribution/reference/agent-eval-pr341-v17-completed.md, docs/backlog/distribution/reference/agent-eval-pr341-v17-offline-proof.json.gz]
code: [tools/agent-bench/corpus/cases/markdown-notes-v4/judge.ts, tools/agent-bench/src/lanes/local-reference.ts, tools/agent-bench/src/lanes/rifty.ts]
---

## Question

What is the observer promise for native confirmations of an action the judge
requested? Public notes prompt leaves implementation/DOM/layout open; neither
it nor native-input-v1 forbids confirmation. No proposed dialog handler,
protocol amendment or oracle change during frozen eval-v17.

Actual path: create/save Alpha and Beta → open Beta → Delete. Native Codex3
opens `confirm('Delete this saved note?')`; default automation dismisses it.
Only delete-persistence probe fails. Exact retained whole after-source, genuine
installed Vite and real Chromium, unchanged judge, two fresh no-model contexts:
default FAIL; accepting only that confirmation full PASS. Every after-file
byte remains unchanged. Original model score remains FAIL; diagnostic is not
another model trial or campaign rescore.

`pnpm exec tsx /tmp/pr341/v17-notes-confirm-observer.mts`; diagnostic script,
raw verdicts/source hashes and original/diagnostic browser ZIPs retained in
linked archive. Native/browser behavior executed, no recalled-default claim.

Owner: distribution/agent-bench. Trigger: formalize native dialog action
observation or reproduce this public path. Rifty sandbox/modal behavior and
general confirmation policies are unmeasured; boundary/axis unsettled.
Capture outside handoff's conditional booking/expense correction scope.

Dedup: distribution titles/code/goal maps, traps, declined concepts and native
input ADRs; no matching dialog-observation item. Existing native-input-v1
records accessible control interactions, no settled modal promise.
