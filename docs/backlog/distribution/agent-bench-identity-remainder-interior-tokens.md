---
area: distribution
status: draft
title: "Which identity remainder should workflowActions derive when the verb or subject word sits inside the literal record name?"
created: 2026-10-16
why: identityEvidenceFor strips the first verb/subject occurrence anywhere in the caption, so a record literally named "Cancel room east" loses its identity evidence and both Edit aliases disappear from workflowActions owner resolution
sources: [docs/adr/distribution/0519-resolve-workflow-operations-through-observable-context.md, docs/adr/distribution/0520-verify-workflow-record-identity-outside-action-captions.md]
code: [tools/agent-bench/src/judge/record-context.ts, tools/agent-bench/src/judge/context.ts, tools/agent-bench/tests/workflow-actions.fault.spec.ts]
---

## Question

`identityEvidenceFor(name, verbs, subjects)` removes the first match of the requested
verb and of the declared subject from the computed caption and treats the rest as the
literal identity. Independent review of PR #375 (fourth verify pass, probe
`cancel-room-east-probe.mts`, real Vue reference of eval-v18 through `node --import tsx`)
showed that a record named "Cancel room east" with two equivalent aliases captioned
"Cancel room east room edit" yields the remainder "Cancel east room": the record is
saved by both aliases, yet `workflowActions` resolves no owner. ADR-0520 forbids a
caption word-order requirement; ADR-0519 keeps opaque identities.

Candidates (`workflowCandidates`) are unaffected since PR #375: pure eligibility no
longer derives identity. The gap is confined to owner resolution in `workflowActions`
and the `recordScopeByIdentity` evidence it feeds.

Open choice for pickup: strip verb/subject only at the caption edges (leading verb,
trailing "subject verb" / "verb subject"), or try every removal position and accept any
remainder with record evidence. Either route needs the interior-token + suffix RED and
the existing `workflow-actions.fault.spec.ts` cases to stay green.

Owner: agent — next judge pickup; the fresh-run requirement of ADR-0532 applies to any
re-measurement that depends on this.
