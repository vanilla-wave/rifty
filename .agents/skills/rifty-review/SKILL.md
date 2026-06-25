---
name: rifty-review
description: Review a pull request for the rifty project — implementation completeness, fit with project goal and architecture, and bugs. Manual invocation only.
disable-model-invocation: true
---

Review the PR.
Especially interested in:
- Completeness of the implementation and absence of deferred/unresolved tasks
- Conformance to the project goal and architecture
- Approach earns its cost — even an on-goal capability is wrong if its implementation is disproportionate or net-negative for user or project; flag and reconsider, don't force it
- Absence of bugs
- No regressions to existing functionality
- Feature's user experience matches the real ecosystem

## Report
Open with an overall verdict + merge call. Then one section per axis above (in order), each with its own verdict (pass / concern / blocker) — never folded into a flat severity-ranked list, never downgraded to a nit. Cite file:line.
